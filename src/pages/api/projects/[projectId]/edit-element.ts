// ─── Element-Level Editing Endpoint ──────────────────────────────────────────
// Edits a single element (h1, p, img, button…) within a section.
// Receives: { sectionId, selector, outerHTML, instruction }
// Sends <style> + section HTML to Sonnet with the exact element identified.
// Reinjects modified style + section back into full HTML.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createMessage } from '../../../../lib/anthropic';
import { SONNET_MODEL } from '../../../../lib/generation';
import { FULL_PAGE_KEY } from '../../../../lib/creative-generation';
import { createAdminClient } from '../../../../lib/supabase';
import { json } from '../../../../lib/api-utils';


function extractStyle(html: string): string {
  return html.match(/<style[\s\S]*?<\/style>/i)?.[0] ?? '';
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

/** Escape special regex characters */
function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractSection(html: string, sectionId: string): string | null {
  const safeSid = escapeRegex(sectionId);
  const byComment = html.match(
    new RegExp(`<!--\\s*SECTION:${safeSid}\\s*-->[\\s\\S]*?<!--\\s*/SECTION:${safeSid}\\s*-->`, 'i')
  );
  if (byComment) return byComment[0];

  return extractByAttr(html, `data-section="${sectionId}"`);
}

function replaceSection(html: string, sectionId: string, newSection: string): string {
  const safeSid = escapeRegex(sectionId);
  const commentRe = new RegExp(
    `<!--\\s*SECTION:${safeSid}\\s*-->[\\s\\S]*?<!--\\s*/SECTION:${safeSid}\\s*-->`, 'i'
  );
  if (commentRe.test(html)) return html.replace(commentRe, newSection);

  const byData = extractByAttr(html, `data-section="${sectionId}"`);
  if (byData) return html.replace(byData, newSection);
  return html;
}

function replaceStyle(html: string, newStyle: string): string {
  return html.replace(/<style[\s\S]*?<\/style>/i, newStyle);
}

/**
 * When the client doesn't know which section contains an element (e.g. the
 * element is directly inside <body> or the data-section attr was missing),
 * scan the full HTML and find the data-section value of the container that
 * holds the given outerHTML snippet.
 */
function detectSectionId(fullHtml: string, outerHTML: string): string | null {
  if (!outerHTML) return null;
  // Find where the outerHTML appears, then scan backwards for the nearest
  // opening tag that has data-section="..."
  const idx = fullHtml.indexOf(outerHTML);
  if (idx === -1) return null;
  const before = fullHtml.slice(0, idx);
  const match = before.match(/data-section="([^"]+)"/g);
  if (!match) return null;
  const last = match[match.length - 1];
  return last.match(/data-section="([^"]+)"/)?.[1] ?? null;
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // ── Project iteration quota pre-check ─────────────────────────────────────
  const projectForQuota = await db.projects.findById(params.projectId!);
  if (!projectForQuota || projectForQuota.user_id !== user.id) return json({ error: 'Not found' }, 404);
  const _used  = (projectForQuota as any).iterations_used  ?? 0;
  const _quota = (projectForQuota as any).iterations_quota ?? 20;
  if (_used >= _quota) {
    return json({
      error: 'iteration_limit_reached',
      used: _used,
      quota: _quota,
      remaining: 0,
    }, 429);
  }
  const admin = createAdminClient();

  try {
    const body = await request.json().catch(() => ({}));
    const { sectionId, selector, outerHTML, instruction } = body as {
      sectionId?: string;
      selector?: string;
      outerHTML?: string;
      instruction?: string;
    };

    if (!instruction?.trim()) return json({ error: 'instruction is required' }, 400);

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const gen = await db.generatedFiles.findLatest(params.projectId!);
    if (!gen?.files?.[FULL_PAGE_KEY]) return json({ error: 'No generated site found' }, 404);

    const fullHtml = gen.files[FULL_PAGE_KEY];

    // If the client didn't know the section, try to detect it from the element's outerHTML
    const resolvedSectionId = sectionId || (outerHTML ? detectSectionId(fullHtml, outerHTML) : null);
    if (!resolvedSectionId) {
      // No section found — signal frontend to fallback to iterate
      return json({ error: 'no_section_match', fallback: true }, 400);
    }

    const currentStyle   = extractStyle(fullHtml);
    const currentSection = extractSection(fullHtml, resolvedSectionId);

    if (!currentSection) return json({ error: `Section "${resolvedSectionId}" not found` }, 404);

    // ── Build Sonnet prompt ────────────────────────────────────────────────────
    const elementContext = outerHTML
      ? `The specific element to modify:\nSelector: ${selector || 'unknown'}\nCurrent HTML: ${outerHTML.slice(0, 800)}`
      : `Selector to target: ${selector || 'unknown'}`;

    const response = await createMessage({
      model: SONNET_MODEL,
      max_tokens: 8000,
      system: `You are editing a single HTML element inside a website section. You receive:
1. The full <style> block of the page
2. The section HTML containing the element
3. The exact element identified by selector and its current HTML

Your task: apply the instruction to ONLY that specific element.

Rules:
- Modify only the targeted element and its CSS classes if needed
- Do NOT restructure the section or change other elements
- If font size, color, spacing changes are needed, update only the relevant CSS rules
- Keep all other elements, animations, and structure intact
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

${elementContext}

## Current <style> block
${currentStyle}

## Full section HTML (${resolvedSectionId})
${currentSection}`,
      }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    // Strip markdown code fences in case Sonnet wraps the output
    const cleaned = raw.replace(/^```[a-z]*\s*/i, '').replace(/\s*```\s*$/, '').trim();

    const styleMatch   = cleaned.match(/<UPDATED_STYLE>([\s\S]*?)<\/UPDATED_STYLE>/i);
    const sectionMatch = cleaned.match(/<UPDATED_SECTION>([\s\S]*?)<\/UPDATED_SECTION>/i);

    if (!styleMatch || !sectionMatch) {
      console.error('[edit-element] Missing delimiters. Raw snippet:', cleaned.slice(0, 500));
      return json({ error: 'Edit failed — try rephrasing the instruction' }, 500);
    }

    const result = {
      style:   styleMatch[1].trim(),
      section: sectionMatch[1].trim(),
    };

    if (!result.style || !result.section) {
      return json({ error: 'Sonnet response missing style or section' }, 500);
    }

    // ── Reinject ──────────────────────────────────────────────────────────────
    let updatedHtml = replaceStyle(fullHtml, result.style);
    updatedHtml = replaceSection(updatedHtml, resolvedSectionId, result.section);

    // Save as new version (preserves previous for undo)
    await db.generatedFiles.create({
      project_id: params.projectId!,
      version: gen.version + 1,
      files: { ...gen.files, [FULL_PAGE_KEY]: updatedHtml },
      generation_cost: 0,
      generation_tokens: 0,
    });

    // Consume one project iteration only after successful save
    try { await admin.rpc('consume_project_iteration', { p_project_id: params.projectId! }); } catch { /* best-effort */ }

    console.log(`[edit-element] "${selector}" in "${resolvedSectionId}" for project ${params.projectId}: "${instruction.slice(0, 60)}"`);

    // Return updated section HTML + CSS so dashboard can hot-swap without reload
    const styleContent = result.style.replace(/<\/?style[^>]*>/gi, '').trim();
    return json({
      success:     true,
      sectionId:   resolvedSectionId,
      sectionHtml: result.section,
      css:         styleContent,
      inputTokens:  response.usage?.input_tokens  ?? 0,
      outputTokens: response.usage?.output_tokens ?? 0,
    });

  } catch (e: any) {
    console.error('[edit-element] Error:', e);
    return json({ error: 'Internal error' }, 500);
  }
};
