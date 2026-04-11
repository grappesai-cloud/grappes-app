// ─── Section-Level Editing Endpoint ──────────────────────────────────────────
// Edits a single section of the generated site without touching the rest.
// Extracts <style> + the target section, sends to Sonnet with the instruction,
// then reinjects the modified style + section back into the full HTML.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createMessage } from '../../../../lib/anthropic';
import { SONNET_MODEL } from '../../../../lib/generation';
import { FULL_PAGE_KEY } from '../../../../lib/creative-generation';
import { checkAndConsumeEdit, getEditQuota } from '../../../../lib/edit-quota';
import { json } from '../../../../lib/api-utils';


// ─── Extraction helpers ───────────────────────────────────────────────────────

/** Escape special regex characters in a string */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractStyle(html: string): string {
  const match = html.match(/<style[\s\S]*?<\/style>/i);
  return match?.[0] ?? '';
}

// Depth-counted extraction by attribute — handles nested same-tag elements correctly
function extractByAttr(html: string, attr: string): string | null {
  const escapedAttr = attr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const tagRe = new RegExp(`<(section|div|nav|header|footer|main)[^>]*${escapedAttr}[^>]*>`, 'i');
  const tagMatch = html.match(tagRe);
  if (!tagMatch) return null;
  const tagName = tagMatch[1].toLowerCase();
  const startPos = html.indexOf(tagMatch[0]);
  const contentStart = startPos + tagMatch[0].length;
  let depth = 1, pos = contentStart;
  const openRe = new RegExp(`<${tagName}\\b`, 'gi');
  const closeRe = new RegExp(`</${tagName}>`, 'gi');
  while (depth > 0 && pos < html.length) {
    openRe.lastIndex = pos; closeRe.lastIndex = pos;
    const nextOpen = openRe.exec(html);
    const nextClose = closeRe.exec(html);
    if (!nextClose) break;
    if (nextOpen && nextOpen.index < nextClose.index) { depth++; pos = nextOpen.index + nextOpen[0].length; }
    else { depth--; if (depth === 0) return html.slice(startPos, nextClose.index + nextClose[0].length); pos = nextClose.index + nextClose[0].length; }
  }
  return null;
}

function extractSection(html: string, sectionId: string): string | null {
  // Try comment markers first: <!-- SECTION:hero -->...<!-- /SECTION:hero -->
  const safeSid = escapeRegex(sectionId);
  const commentRe = new RegExp(
    `<!--\\s*SECTION:${safeSid}\\s*-->[\\s\\S]*?<!--\\s*/SECTION:${safeSid}\\s*-->`,
    'i'
  );
  const commentMatch = html.match(commentRe);
  if (commentMatch) return commentMatch[0];

  // Fallback: depth-counted extraction by data-section or id
  return extractByAttr(html, `data-section="${sectionId}"`)
      || extractByAttr(html, `id="${sectionId}"`);
}

function replaceSection(html: string, sectionId: string, newSection: string): string {
  // Replace by comment markers
  const safeSid = escapeRegex(sectionId);
  const commentRe = new RegExp(
    `<!--\\s*SECTION:${safeSid}\\s*-->[\\s\\S]*?<!--\\s*/SECTION:${safeSid}\\s*-->`,
    'i'
  );
  if (commentRe.test(html)) {
    return html.replace(commentRe, newSection);
  }

  // Fallback: depth-counted extraction then replace
  const byData = extractByAttr(html, `data-section="${sectionId}"`);
  if (byData) return html.replace(byData, newSection);
  const byId = extractByAttr(html, `id="${sectionId}"`);
  if (byId) return html.replace(byId, newSection);
  return html;
}

function replaceStyle(html: string, newStyle: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/i, newStyle);
}

// ─── Route ────────────────────────────────────────────────────────────────────

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // ── Quota pre-check (read-only — consumption happens after success) ─────
  const quotaCheck = await getEditQuota(user.id);
  if (!quotaCheck.allowed) {
    return json({
      error: 'edit_limit_reached',
      used: quotaCheck.used,
      limit: quotaCheck.limit,
      extra: quotaCheck.extra,
      plan: quotaCheck.plan,
    }, 429);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { sectionId, instruction } = body as { sectionId?: string; instruction?: string };

    if (!sectionId?.trim() || !instruction?.trim()) {
      return json({ error: 'sectionId and instruction are required' }, 400);
    }

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const gen = await db.generatedFiles.findLatest(params.projectId!);
    if (!gen?.files?.[FULL_PAGE_KEY]) return json({ error: 'No generated site found' }, 404);

    const fullHtml = gen.files[FULL_PAGE_KEY];

    // ── Extract style + target section ────────────────────────────────────────
    const currentStyle = extractStyle(fullHtml);
    const currentSection = extractSection(fullHtml, sectionId);

    if (!currentSection) {
      return json({ error: `Section "${sectionId}" not found in HTML` }, 404);
    }

    // ── Send to Sonnet ────────────────────────────────────────────────────────
    const response = await createMessage({
      model: SONNET_MODEL,
      max_tokens: 8000,
      system: `You are editing a single section of a website. You receive:
1. The current <style> block (full page CSS)
2. The current section HTML

Your task: apply the user's instruction to ONLY this section.

Rules:
- Modify the section HTML as requested
- If CSS changes are needed, modify ONLY the classes/rules relevant to this section in the style block
- Do NOT change any other section's styles or markup
- Keep comment markers (<!-- SECTION:... --> / <!-- /SECTION:... -->) if present
- Understand and apply instructions written in any language (Romanian, English, etc.)
- QUOTED TEXT RULE: if the user puts text inside quotes (e.g. "Descoperă natura"), use that text EXACTLY as written — character for character, no rewording. Text without quotes can be freely reworded to fit the design.
- Output ONLY the two blocks below, no explanations:

<UPDATED_STYLE>
...complete updated <style>...</style> block here...
</UPDATED_STYLE>
<UPDATED_SECTION>
...complete updated section HTML here...
</UPDATED_SECTION>`,
      messages: [{
        role: 'user',
        content: `Instruction: ${instruction.trim()}

## Current <style> block
${currentStyle}

## Current section (${sectionId})
${currentSection}`,
      }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    // Strip markdown code fences in case Sonnet wraps the output
    const cleaned = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim();

    const styleMatch   = cleaned.match(/<UPDATED_STYLE>([\s\S]*?)<\/UPDATED_STYLE>/i);
    const sectionMatch = cleaned.match(/<UPDATED_SECTION>([\s\S]*?)<\/UPDATED_SECTION>/i);

    if (!styleMatch || !sectionMatch) {
      console.error('[edit-section] Missing delimiters. Raw snippet:', cleaned.slice(0, 500));
      return json({ error: 'Edit failed — try rephrasing the instruction' }, 500);
    }

    const result = {
      style:   styleMatch[1].trim(),
      section: sectionMatch[1].trim(),
    };

    if (!result.style || !result.section) {
      return json({ error: 'Sonnet response missing style or section' }, 500);
    }

    // ── Reinject into full HTML ───────────────────────────────────────────────
    let updatedHtml = replaceStyle(fullHtml, result.style);
    updatedHtml = replaceSection(updatedHtml, sectionId, result.section);

    // ── Save as new version (preserves previous for undo) ─────────────────
    const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: updatedHtml };
    await db.generatedFiles.create({
      project_id: params.projectId!,
      version: gen.version + 1,
      files: updatedFiles,
      generation_cost: 0,
      generation_tokens: 0,
    });

    // Consume edit quota only after successful save
    await checkAndConsumeEdit(user.id);

    console.log(`[edit-section] "${sectionId}" edited for project ${params.projectId}: "${instruction.slice(0, 60)}"`);

    return json({
      success: true,
      sectionId,
      inputTokens:  response.usage?.input_tokens  ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    });

  } catch (e: any) {
    console.error('[edit-section] Error:', e);
    return json({ error: 'Internal error' }, 500);
  }
};
