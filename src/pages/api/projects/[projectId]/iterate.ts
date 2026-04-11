// ─── Iterate endpoint (Phase 2) ──────────────────────────────────────────────
// Whole-page iteration via chat. User sends feedback, Sonnet sees the current
// HTML + screenshots and returns the complete updated HTML.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { FULL_PAGE_KEY, extractHtml, injectAnalytics, injectBacklink, injectFormHandler } from '../../../../lib/creative-generation';
import { SONNET_MODEL, SONNET_INPUT_COST, SONNET_OUTPUT_COST } from '../../../../lib/generation';
import { createMessage } from '../../../../lib/anthropic';
import { runStructuralQA } from '../../../../lib/structural-qa';
import { runPageVisualQA } from '../../../../lib/visual-qa';
import { checkAndConsumeEdit, getEditQuota } from '../../../../lib/edit-quota';
import { json } from '../../../../lib/api-utils';


const CHAT_KEY    = '__chat__page';
const ITERATE_SYSTEM_PROMPT = `You are editing an existing website. The user wants changes. You receive the current HTML and screenshots showing how it currently looks on desktop and mobile.

Apply the requested changes and return the COMPLETE updated HTML file. The HTML must be a self-contained file with all CSS in <style> and all JS in <script>.

RULES:
- Output ONLY the complete HTML — no explanation before or after
- Start with <!DOCTYPE html> and end with </html>
- Preserve the overall structure: section comment markers (<!-- SECTION:xxx -->), data-section attributes, meta tags, external CDN links
- If the user asks for something that would break accessibility or SEO basics, do it but mention the tradeoff
- Fix any visual bugs you spot in the screenshots proactively while making the requested changes
- Keep all existing animations and interactions unless the user asks to change them`;

// ── GET — page info + chat history ──────────────────────────────────────────

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const gen = await db.generatedFiles.findLatest(params.projectId!);
  if (!gen?.files) return json({ sections: [], chats: {}, screenshots: {}, previewUrl: null });

  // For backward compatibility, build a section list from full-page HTML
  // The new system has a single "page" entry; legacy projects keep their section list
  const fullHtml = gen.files[FULL_PAGE_KEY];

  let chatHistory: Array<{ role: string; content: string }> = [];
  try { if (gen.files[CHAT_KEY]) chatHistory = JSON.parse(gen.files[CHAT_KEY]); } catch {}

  if (fullHtml) {
    // New whole-page approach: single "page" section
    return json({
      sections: [{ id: 'page', label: 'Full Page', hasChat: chatHistory.length > 0 }],
      chats: chatHistory.length > 0 ? { page: chatHistory } : {},
      screenshots: {},
      previewUrl: `/preview/${params.projectId}`,
    });
  }

  // Legacy fallback: return empty (old iterate.ts section list is no longer built here)
  return json({ sections: [], chats: {}, screenshots: {}, previewUrl: `/preview/${params.projectId}` });
};

// ── POST — iterate the whole page ───────────────────────────────────────────

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // ── Quota: consume 4 edits atomically BEFORE the AI call ────────────────
  const quotaCheck = await getEditQuota(user.id);
  if (quotaCheck.remaining < 4) {
    return json({
      error: 'edit_limit_reached',
      used: quotaCheck.used,
      limit: quotaCheck.limit,
      extra: quotaCheck.extra,
      plan: quotaCheck.plan,
      required: 4,
      available: quotaCheck.remaining,
    }, 429);
  }

  // Reserve credits upfront (refunded on failure)
  let creditsConsumed = 0;
  for (let i = 0; i < 4; i++) {
    const ok = await checkAndConsumeEdit(user.id);
    if (ok) creditsConsumed++;
    else break;
  }
  if (creditsConsumed < 4) {
    // Partial reserve — refund what we took (race with concurrent request)
    if (creditsConsumed > 0) {
      try {
        const { createAdminClient } = await import('../../../../lib/supabase');
        await createAdminClient().rpc('refund_edits', { p_user_id: user.id, p_amount: creditsConsumed });
      } catch { /* best-effort */ }
    }
    return json({ error: 'edit_limit_reached', required: 4, available: creditsConsumed }, 429);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { message } = body as { message?: string; sectionId?: string };

    if (!message?.trim()) {
      return json({ error: 'message is required' }, 400);
    }

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const gen = await db.generatedFiles.findLatest(params.projectId!);
    if (!gen?.files) return json({ error: 'No generated files found. Launch the site first.' }, 409);

    const currentHtml = gen.files[FULL_PAGE_KEY];
    if (!currentHtml) return json({ error: 'No full page HTML found. Re-generate the site.' }, 404);

    // Load chat history
    let chatHistory: Array<{ role: 'user' | 'assistant'; content: string }> = [];
    try { if (gen.files[CHAT_KEY]) chatHistory = JSON.parse(gen.files[CHAT_KEY]); } catch {}

    // ── Step 1: Take screenshots of current HTML ─────────────────────────────
    let screenshots: { desktop: string; mobile: string } = { desktop: '', mobile: '' };
    let usedVision = false;
    try {
      const qaResult = await runPageVisualQA(currentHtml);
      screenshots = qaResult.screenshots;
      usedVision = !!(screenshots.desktop || screenshots.mobile);
    } catch (e) {
      console.warn('[iterate] Screenshot capture failed (non-fatal):', e);
    }

    // ── Step 2: Build messages for Sonnet ────────────────────────────────────
    const messages: Array<{ role: 'user' | 'assistant'; content: any }> = [];

    // Initial context message with the current HTML
    messages.push({
      role: 'user',
      content: `Here is the current HTML of the website:\n\n${currentHtml}`,
    });
    messages.push({
      role: 'assistant',
      content: 'I have the current HTML. Ready for your feedback.',
    });

    // Include prior chat history (text-only for context)
    for (const m of chatHistory) {
      messages.push({ role: m.role as 'user' | 'assistant', content: m.content });
    }

    // Final user message with screenshots (vision) if available
    if (usedVision) {
      const contentBlocks: any[] = [
        { type: 'text', text: 'Current visual state of the page:' },
      ];
      if (screenshots.desktop) {
        contentBlocks.push({ type: 'text', text: 'Desktop screenshot:' });
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshots.desktop } });
      }
      if (screenshots.mobile) {
        contentBlocks.push({ type: 'text', text: 'Mobile screenshot:' });
        contentBlocks.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: screenshots.mobile } });
      }
      contentBlocks.push({ type: 'text', text: `User's requested changes:\n${message.trim()}` });
      messages.push({ role: 'user', content: contentBlocks });
    } else {
      messages.push({ role: 'user', content: message.trim() });
    }

    // ── Step 3: Call Sonnet ───────────────────────────────────────────────────
    const response = await createMessage({
      model: SONNET_MODEL,
      max_tokens: 64000,
      system: ITERATE_SYSTEM_PROMPT,
      messages,
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    let newHtml = extractHtml(raw);

    // If extraction didn't find valid HTML, keep the current version
    if (!newHtml.includes('</html>')) {
      console.warn('[iterate] Sonnet did not return complete HTML, keeping current version');
      return json({ reply: 'Edit failed — the change was too complex. Try a more specific instruction (e.g. "change the heading text to X").', newHtml: null });
    }

    // Inject analytics beacon
    const brief = await db.briefs.findByProjectId(params.projectId!);
    newHtml = injectAnalytics(newHtml, brief?.data ?? {}, params.projectId!);

    // Inject backlink + normalize copyright year
    newHtml = injectBacklink(newHtml);

    // Wire contact forms to /api/forms/:projectId
    newHtml = injectFormHandler(newHtml, params.projectId!);

    // ── Step 4: Run structural QA ────────────────────────────────────────────
    const qa = runStructuralQA(newHtml);
    if (!qa.passed) {
      console.warn(`[iterate] Structural QA: ${qa.score}% — ${qa.checks.filter(c => !c.passed).map(c => c.name).join(', ')}`);
    }

    // Build a reply message (since Sonnet outputs only HTML, create a confirmation)
    const reply = 'Changes applied.';

    // ── Step 5: Persist updated HTML + chat history ──────────────────────────
    const updatedHistory = [
      ...chatHistory,
      { role: 'user' as const, content: message.trim() },
      { role: 'assistant' as const, content: reply },
    ];

    const updatedFiles = {
      ...gen.files,
      [FULL_PAGE_KEY]: newHtml,
      [CHAT_KEY]: JSON.stringify(updatedHistory),
    };

    await db.generatedFiles.create({
      project_id: params.projectId!,
      version:    gen.version + 1,
      files:      updatedFiles,
      generation_cost:   0,
      generation_tokens: 0,
    });

    // Credits already consumed upfront — no action needed here

    await db.costs.create({
      project_id:    params.projectId!,
      type:          'generation',
      model:         SONNET_MODEL,
      input_tokens:  response.usage?.input_tokens ?? 0,
      output_tokens: response.usage?.output_tokens ?? 0,
      cost_usd:      (response.usage?.input_tokens ?? 0) * SONNET_INPUT_COST +
                     (response.usage?.output_tokens ?? 0) * SONNET_OUTPUT_COST,
    });

    // ── Step 6: Return — client reloads the iframe ───────────────────────────
    return json({
      reply,
      newHtml,
      history:    updatedHistory,
      usedVision,
    });

  } catch (e: any) {
    console.error('[POST /api/projects/:id/iterate]', e);
    // Refund the 4 credits consumed upfront since the operation failed
    try {
      const { createAdminClient } = await import('../../../../lib/supabase');
      await createAdminClient().rpc('refund_edits', { p_user_id: user.id, p_amount: 4 });
    } catch { /* best-effort refund */ }
    return json({ error: 'Internal server error' }, 500);
  }
};
