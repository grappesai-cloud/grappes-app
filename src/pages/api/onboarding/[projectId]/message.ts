import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { anthropic, createMessage, HAIKU_MODEL, HAIKU_SYSTEM_PROMPT, INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN } from '../../../../lib/anthropic';
import { sectionLibraryAsPrompt } from '../../../../lib/section-library';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { parseHaikuResponse, calculateCompleteness, compressHistory, applySmartDefaults } from '../../../../lib/onboarding';
import type { ConversationPhase } from '../../../../lib/db';

import { json } from '../../../../lib/api-utils';
const langNames: Record<string, string> = { ro: 'Romanian', en: 'English', fr: 'French', de: 'German', es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch', pl: 'Polish', hu: 'Hungarian' };


/** Build a human-readable summary of collected fields so Haiku can't miss them */
function buildDepthAndSectionsBlock(depth: string, selectedSections: string[] | undefined): string {
  const d = (['quick', 'standard', 'deep'].includes(depth) ? depth : 'standard') as 'quick' | 'standard' | 'deep';
  const depthRules: Record<typeof d, string> = {
    quick:    'QUICK MODE: cap onboarding at ~5 questions total. Auto-pick sections (hero, about, services, contact) — do NOT propose a section list, do NOT ask the user to confirm sections. Skip testimonials/portfolio/team/pricing/etc unless the user volunteers them.',
    standard: 'STANDARD MODE: aim for ~10 questions total. After learning business name + industry + core offering, propose 4-7 section keys from the library that fit the business and ask the user to confirm or edit. Then ask 1 brief question per chosen section.',
    deep:     'DEEP MODE: aim for 15-20 questions. After business discovery, propose 6-10 sections, then ask 1-2 detail questions per section (sample work, copy preferences, mood, social proof). Cover SEO keywords, target audience, brand voice in detail.',
  };
  let block = `\n\nONBOARDING DEPTH: ${d.toUpperCase()}\n${depthRules[d]}`;
  block += `\n\nUNIVERSAL SECTION LIBRARY (use these KEYS exactly when you save business.selectedSections):\n${sectionLibraryAsPrompt()}`;
  block += `\n\nSECTION SELECTION FLOW (skip in QUICK mode):\n1. After learning business name + industry + core offering, briefly summarize them.\n2. Propose 4-10 section keys that fit (e.g. "I'd suggest: hero, about, services, portfolio, testimonials, contact"). Use the keys above, comma-separated, lowercase.\n3. Ask the user to confirm or edit (add/remove). Then save the final array to business.selectedSections.\n4. After confirmation, ask 1 (standard) or 2 (deep) brief content questions per selected section, in order.`;
  if (selectedSections && selectedSections.length > 0) {
    block += `\n\nSECTIONS ALREADY CONFIRMED for this site: [${selectedSections.join(', ')}]. Do NOT re-propose a section list. Continue asking content questions for these sections in order.`;
  }
  return block;
}

function buildCollectedSummary(data: Record<string, any>): string {
  const lines: string[] = [];
  const get = (path: string) => path.split('.').reduce((o, k) => o?.[k], data);
  const add = (label: string, path: string) => {
    const v = get(path);
    if (v !== undefined && v !== null && v !== ('' as any) && !(Array.isArray(v) && v.length === 0)) {
      lines.push(`- ${label}: ${typeof v === 'object' ? JSON.stringify(v) : v}`);
    }
  };
  add('Website type', 'preferences.websiteType');
  add('Complexity', 'preferences.complexity');
  add('Business name', 'business.name');
  add('Industry', 'business.industry');
  add('Description', 'business.description');
  add('Tagline', 'business.tagline');
  add('Target audience', 'target_audience.primary');
  add('Headline', 'content.headline');
  add('Opening line', 'content.opening_line');
  add('About', 'content.about');
  add('Services', 'content.services');
  add('Sections', 'content.sections');
  add('Pages', 'content.pages');
  add('Testimonials', 'content.testimonials');
  add('Stats', 'content.stats');
  add('Team', 'content.team');
  add('Contact email', 'contact.email');
  add('Contact phone', 'contact.phone');
  add('Contact address', 'contact.address');
  add('Primary color', 'branding.colors.primary');
  add('Secondary color', 'branding.colors.secondary');
  add('Accent color', 'branding.colors.accent');
  add('Heading font', 'branding.fonts.heading');
  add('Body font', 'branding.fonts.body');
  add('Style', 'branding.style');
  add('Has logo', 'media.has_logo');
  add('No photos (typography-only)', 'media.no_photos');
  add('Contact form', 'features.contact_form');
  add('Blog', 'features.blog');
  add('Newsletter', 'features.newsletter');
  add('Booking', 'features.booking');
  add('E-commerce', 'features.ecommerce');
  add('Locale', 'business.locale');
  add('Meta title', 'meta.title');
  add('Meta description', 'meta.description');
  add('Instagram', 'social.instagram');
  add('Facebook', 'social.facebook');
  add('Twitter', 'social.twitter');
  add('LinkedIn', 'social.linkedin');
  return lines.length > 0 ? lines.join('\n') : '';
}

// Synthetic messages sent to Haiku after a media action (not shown as user bubble)
function buildActionMessage(action: string, type: string, extra?: Record<string, any>): string {
  if (action === 'media_uploaded') {
    const uploads = extra?.uploads as Array<{type: string; assetId?: string}> | undefined;
    const contextNote = extra?.userContext ? ` Note from user: "${extra.userContext}"` : '';

    if (uploads && uploads.length > 1) {
      const labelMap: Record<string, string> = { logo: 'logo', hero: 'hero image', og: 'OG/social image', section: 'section image', menu: 'menu photo' };
      const labels = uploads.map(u => labelMap[u.type] ?? u.type).join(', ');
      return `I've uploaded ${uploads.length} images: ${labels}.${contextNote} Please acknowledge all of them and continue to the next asset or phase.`;
    }

    const label = type === 'logo' ? 'logo' : type === 'hero' ? 'hero image' : extra?.sectionTitle ? `image for "${extra.sectionTitle}"` : `${type} image`;
    return `I've uploaded my ${label} successfully.${contextNote} Please continue to the next asset or phase.`;
  }
  if (action === 'media_skipped') {
    const fallback = extra?.fallback ? ` (preferred: ${extra.fallback})` : '';
    return `I'm skipping the ${type} image${fallback}. Please continue to the next asset or phase.`;
  }
  if (action === 'media_note') {
    return `For the "${extra?.sectionTitle || type}" section: ${extra?.note || 'no specific note'}. Continue.`;
  }
  if (action === 'media_choice') {
    return `For the ${type}: I chose "${extra?.choice}". Please continue.`;
  }
  if (action === 'menu_uploaded') {
    return `I've uploaded a photo of my menu. Please acknowledge it and continue to the next phase.`;
  }
  return 'Please continue to the next step.';
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 60 messages per hour per project (onboarding shouldn't need more)
  if (!checkRateLimit(`onboarding:${params.projectId}:${user.id}`, 60, 3_600_000)) {
    return json({ error: 'Too many messages. Please wait before continuing.' }, 429);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const userMessage: string | undefined = (body.message as string)?.trim() || undefined;
    const isInit: boolean = body.init === true || (!userMessage && !body.action);
    const mediaAction: string | undefined = body.action as string | undefined;
    const browserLang: string = (body.browserLang as string)?.trim() || 'en';

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const conv = await db.conversations.findByProjectId(params.projectId!);
    if (!conv) return json({ error: 'Conversation not found' }, 404);

    const brief = await db.briefs.findByProjectId(params.projectId!);

    // ── Handle direct media actions ─────────────────────────────────────────
    if (mediaAction) {
      const { type, assetId, fallback, note, sectionId, sectionTitle, choice, userContext, uploads } = body;
      // uploads is an array [{type, assetId}] from multi-upload; fall back to single-upload fields

      // ── Menu photo: extract text via vision ──
      if (mediaAction === 'menu_uploaded' && body.assetUrl) {
        try {
          const visionResponse = await createMessage({
            model: HAIKU_MODEL,
            max_tokens: 2000,
            system: 'Extract all menu items from this photo. Return JSON: { "categories": [{ "name": "Category Name", "items": [{ "name": "Item", "price": "price as shown", "description": "optional" }] }] }. Output ONLY valid JSON.',
            messages: [{
              role: 'user',
              content: [
                { type: 'text', text: 'Extract the menu from this photo:' },
                { type: 'image', source: { type: 'url', url: body.assetUrl } },
              ],
            }],
          });

          const visionRaw = visionResponse.content[0]?.type === 'text' ? visionResponse.content[0].text : '{}';
          const cleaned = visionRaw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

          const vInTokens = visionResponse.usage?.input_tokens ?? 0;
          const vOutTokens = visionResponse.usage?.output_tokens ?? 0;
          await db.costs.create({
            project_id: params.projectId!, type: 'onboarding', model: HAIKU_MODEL,
            input_tokens: vInTokens, output_tokens: vOutTokens,
            cost_usd: vInTokens * INPUT_COST_PER_TOKEN + vOutTokens * OUTPUT_COST_PER_TOKEN,
          });

          try {
            const menuData = JSON.parse(cleaned);
            await db.briefs.merge(params.projectId!, { 'content.menu': menuData });
          } catch {
            // JSON parse failed — store raw and surface warning via synthetic message
            await db.briefs.merge(params.projectId!, { 'content.menu_raw': cleaned });
            return json({
              reply: 'Nu am reușit să citesc meniul din această fotografie — calitatea imaginii e prea slabă sau textul nu e lizibil. Poți încerca cu o altă fotografie mai clară, sau îmi poți scrie manual câteva categorii și produse.',
              phase: conv.phase,
              completeness: brief ? calculateCompleteness(brief.data) : 0,
              isReviewReady: false, isComplete: false,
            });
          }
        } catch (e) {
          console.warn('[message] Menu vision extraction failed (non-fatal):', e);
          return json({
            reply: 'A apărut o eroare la procesarea fotografiei meniului. Poți încerca din nou cu o altă imagine, sau îmi poți descrie meniul pe scurt.',
            phase: conv.phase,
            completeness: brief ? calculateCompleteness(brief.data) : 0,
            isReviewReady: false, isComplete: false,
          });
        }
      }

      // Update brief metadata for the action (non-fatal)
      try {
        if (mediaAction === 'media_skipped' && fallback && type === 'hero') {
          await db.briefs.merge(params.projectId!, { 'media.hero_skipped': true });
        }
        if (mediaAction === 'media_note' && sectionId && note) {
          const brief2 = await db.briefs.findByProjectId(params.projectId!);
          const notes = { ...(brief2?.data?.media?.sectionNotes ?? {}), [sectionId]: note };
          await db.briefs.merge(params.projectId!, { 'media.sectionNotes': notes });
        }
      } catch (e) {
        console.warn('[message] brief update non-fatal:', e);
      }

      // Build synthetic message for Haiku
      const effectiveType = uploads?.[0]?.type ?? type;
      const syntheticMsg = buildActionMessage(mediaAction, effectiveType, { fallback, note, sectionId, sectionTitle, choice, userContext, uploads });

      // Call Haiku with synthetic message (not stored as user message)
      const messages = compressHistory(conv.messages);
      const claudeMessages: { role: 'user' | 'assistant'; content: string }[] = [];
      for (const m of messages) claudeMessages.push({ role: m.role, content: m.content });
      claudeMessages.push({ role: 'user', content: syntheticMsg });

      let systemPrompt = HAIKU_SYSTEM_PROMPT;

      // Resolve conversation & site locale.
      // briefLocale  → chat language  (user selected via language picker at project start; fallback: browser)
      // siteLocale   → generated-website language (same picker, existing slot `business.locale`)
      const briefLocale = (brief?.data?.business?.briefLocale as string | undefined) || browserLang;
      const siteLocale  = (brief?.data?.business?.locale      as string | undefined) || briefLocale;
      const briefLangLabel = langNames[briefLocale] || briefLocale;
      const siteLangLabel  = langNames[siteLocale]  || siteLocale;

      systemPrompt += `\n\nCONVERSATION LANGUAGE: The user picked "${briefLangLabel}" (${briefLocale}) for the chat. Conduct the ENTIRE conversation in ${briefLangLabel}. All your replies MUST be in ${briefLangLabel}.\n\nWEBSITE LANGUAGE: The user separately picked "${siteLangLabel}" (${siteLocale}) for the generated website. This is already stored in business.locale — do NOT ask the user again what language the site should be in. Only ask if the user explicitly wants to change it.`;
      systemPrompt += buildDepthAndSectionsBlock((brief?.data?.business?.depth as string | undefined) || 'standard', brief?.data?.business?.selectedSections as string[] | undefined);
      if (project.billing_status !== 'active') {
        systemPrompt += `\n\nPLAN RESTRICTION: This user is on the free plan. Multi-page websites require a separate paid plan. If the user asks for multi-page: explain it requires upgrading the plan, and recommend the landing page as the better choice anyway (faster, higher conversion rate). Do NOT set preferences.websiteType to "multi-page" for this user.`;
      }
      if (brief?.data && Object.keys(brief.data).length > 0) {
        const summary = buildCollectedSummary(brief.data);
        if (summary) {
          systemPrompt += `\n\n⚠️ ALREADY COLLECTED — DO NOT ask about these again, they are confirmed:\n${summary}\n\nIf you ask about ANY field listed above, you are making an error. Move to the NEXT missing field.`;
        }
      }

      const response = await createMessage({
        model: HAIKU_MODEL, max_tokens: 2048,
        system: systemPrompt,
        messages: claudeMessages,
      });

      const rawContent = response.content[0]?.type === 'text' ? response.content[0].text : '';
      const { reply, extracted, newPhase, isComplete, uiAction } = parseHaikuResponse(rawContent);

      // Safety: free plan cannot have multi-page set regardless of what Haiku extracted
      if (project.billing_status !== 'active' && extracted['preferences.websiteType'] === 'multi-page') {
        extracted['preferences.websiteType'] = 'landing';
      }

      let updatedBrief = brief;
      if (Object.keys(extracted).length > 0) updatedBrief = await db.briefs.merge(params.projectId!, extracted);
      const completeness = calculateCompleteness(updatedBrief?.data ?? {});
      if (updatedBrief) await db.briefs.update(params.projectId!, updatedBrief.data, completeness);

      const currentPhase: ConversationPhase = newPhase ?? conv.phase;
      if (newPhase && newPhase !== conv.phase) await db.conversations.updatePhase(params.projectId!, newPhase as ConversationPhase);

      // Auto-confirm brief and set project ready when complete (with smart defaults)
      if (isComplete) {
        try {
          const freshBrief = await db.briefs.findByProjectId(params.projectId!);
          if (freshBrief) {
            const enriched = applySmartDefaults(freshBrief.data);
            await db.briefs.update(params.projectId!, enriched, calculateCompleteness(enriched));
          }
          await db.briefs.confirm(params.projectId!);
          await db.projects.update(params.projectId!, { status: 'brief_ready' } as any);
        } catch (e) { console.warn('[message] Auto-confirm non-fatal:', e); }
      }

      // Store synthetic user message + assistant reply for conversation continuity
      // (prevents orphaned assistant messages that break alternating user/assistant pattern)
      const actionTs = new Date().toISOString();
      await db.conversations.appendMessage(params.projectId!, {
        role: 'user', content: syntheticMsg, timestamp: actionTs,
      });
      await db.conversations.appendMessage(params.projectId!, {
        role: 'assistant', content: reply, timestamp: actionTs,
      });

      const inputTokens = response.usage?.input_tokens ?? 0;
      const outputTokens = response.usage?.output_tokens ?? 0;
      await db.costs.create({
        project_id: params.projectId!, type: 'onboarding', model: HAIKU_MODEL,
        input_tokens: inputTokens, output_tokens: outputTokens,
        cost_usd: inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN,
      });

      return json({ reply, completeness, phase: currentPhase, isReviewReady: isComplete || completeness >= 0.85, isComplete, uiAction: uiAction ?? null });
    }

    // ── Init: return last message (restore completion state on refresh) ────
    if (isInit && conv.messages.length > 0) {
      const lastAssistant = [...conv.messages].reverse().find(m => m.role === 'assistant');
      if (lastAssistant) {
        const initCompleteness = brief?.completeness ?? 0;
        const initIsComplete = brief?.confirmed ?? false;
        // Restore last uiAction from brief metadata (persisted during chat)
        const lastUiAction = brief?.data?._lastUiAction ?? null;
        return json({
          reply: lastAssistant.content,
          completeness: initCompleteness,
          phase: conv.phase,
          isReviewReady: initIsComplete || initCompleteness >= 0.85,
          isComplete: initIsComplete,
          uiAction: lastUiAction,
        });
      }
    }

    // ── Regular message flow ─────────────────────────────────────────────────
    const messages = compressHistory(conv.messages);
    const claudeMessages: { role: 'user' | 'assistant'; content: string }[] = [];
    for (const m of messages) claudeMessages.push({ role: m.role, content: m.content });

    if (!isInit && userMessage) {
      claudeMessages.push({ role: 'user', content: userMessage });
    } else {
      claudeMessages.push({
        role: 'user',
        content: `Project name: "${project.name}". Please begin the onboarding interview — introduce yourself briefly, then ask the first question about the website type.`,
      });
    }

    let systemPrompt = HAIKU_SYSTEM_PROMPT;
    // Prefer the explicit briefLocale chosen at project start; fall back to browser hint.
    const chatLocale = (brief?.data?.business?.briefLocale as string | undefined) || browserLang;
    const langLabel2 = langNames[chatLocale] || 'English';
    systemPrompt += `\n\nLANGUAGE: The user's language is set to "${langLabel2}" (${chatLocale}). Conduct the ENTIRE conversation in ${langLabel2}. ALL your replies MUST be in ${langLabel2} — no exceptions.`;
    systemPrompt += buildDepthAndSectionsBlock((brief?.data?.business?.depth as string | undefined) || 'standard', brief?.data?.business?.selectedSections as string[] | undefined);
    if (project.billing_status !== 'active') {
      systemPrompt += `\n\nPLAN RESTRICTION: This user is on the free plan. Multi-page websites require a separate paid plan. If the user asks for multi-page: explain it requires upgrading the plan, and recommend the landing page as the better choice anyway (faster, higher conversion rate). Do NOT set preferences.websiteType to "multi-page" for this user.`;
    }
    if (brief?.data && Object.keys(brief.data).length > 0) {
      const summary = buildCollectedSummary(brief.data);
      if (summary) {
        systemPrompt += `\n\n⚠️ ALREADY COLLECTED — DO NOT ask about these again, they are confirmed:\n${summary}\n\nIf you ask about ANY field listed above, you are making an error. Move to the NEXT missing field.`;
      }
    }

    // Save user message before API call so it's preserved even if call fails
    const now = new Date().toISOString();
    if (!isInit && userMessage) {
      await db.conversations.appendMessage(params.projectId!, { role: 'user', content: userMessage, timestamp: now });
    }

    const response = await createMessage({
      model: HAIKU_MODEL, max_tokens: 2048,
      system: systemPrompt,
      messages: claudeMessages,
    });

    const rawContent = response.content[0]?.type === 'text' ? response.content[0].text : '';
    console.log(`[message] Haiku raw response (first 500): ${rawContent.slice(0, 500)}`);
    console.log(`[message] Haiku raw response has ---DATA---: ${rawContent.includes('---DATA---')}`);

    const { reply, extracted, newPhase, isComplete, uiAction } = parseHaikuResponse(rawContent);
    console.log(`[message] Extracted keys: ${Object.keys(extracted).join(', ') || 'NONE'}`);
    console.log(`[message] Extracted count: ${Object.keys(extracted).length}, isComplete: ${isComplete}, phase: ${newPhase || 'unchanged'}`);

    // Safety: free plan cannot have multi-page set regardless of what Haiku extracted
    if (project.billing_status !== 'active' && extracted['preferences.websiteType'] === 'multi-page') {
      extracted['preferences.websiteType'] = 'landing';
    }

    let updatedBrief = brief;
    if (Object.keys(extracted).length > 0) {
      console.log(`[message] Merging ${Object.keys(extracted).length} keys into brief`);
      updatedBrief = await db.briefs.merge(params.projectId!, extracted);
    } else if (!isInit && userMessage) {
      // Zero extraction from a real user message — Haiku likely missed the ---DATA--- format.
      // Log the issue; the reply itself still goes through so the user isn't stuck.
      console.warn(`[message] WARNING: Zero extracted data from Haiku response. Raw (first 300): ${rawContent.slice(0, 300)}`);
    }

    const completeness = calculateCompleteness(updatedBrief?.data ?? {});
    console.log(`[message] Brief completeness after merge: ${(completeness * 100).toFixed(0)}%, data keys: ${Object.keys(updatedBrief?.data ?? {}).length}`);
    if (updatedBrief) await db.briefs.update(params.projectId!, updatedBrief.data, completeness);

    const currentPhase: ConversationPhase = newPhase ?? conv.phase;
    if (newPhase && newPhase !== conv.phase) await db.conversations.updatePhase(params.projectId!, newPhase as ConversationPhase);

    // Auto-confirm brief and set project ready when complete (with smart defaults)
    if (isComplete) {
      try {
        const freshBrief = await db.briefs.findByProjectId(params.projectId!);
        if (freshBrief) {
          const enriched = applySmartDefaults(freshBrief.data);
          await db.briefs.update(params.projectId!, enriched, calculateCompleteness(enriched));
        }
        await db.briefs.confirm(params.projectId!);
        await db.projects.update(params.projectId!, { status: 'brief_ready' } as any);
      } catch (e) { console.warn('[message] Auto-confirm non-fatal:', e); }
    }

    await db.conversations.appendMessage(params.projectId!, { role: 'assistant', content: reply, timestamp: now });

    // Persist last uiAction in brief metadata so it can be restored on page refresh
    if (uiAction) {
      await db.briefs.merge(params.projectId!, { '_lastUiAction': uiAction });
    } else {
      // Clear stale uiAction when Haiku moves on without one
      await db.briefs.merge(params.projectId!, { '_lastUiAction': null });
    }

    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    await db.costs.create({
      project_id: params.projectId!, type: 'onboarding', model: HAIKU_MODEL,
      input_tokens: inputTokens, output_tokens: outputTokens,
      cost_usd: inputTokens * INPUT_COST_PER_TOKEN + outputTokens * OUTPUT_COST_PER_TOKEN,
    });

    return json({ reply, completeness, phase: currentPhase, isReviewReady: isComplete || completeness >= 0.85, isComplete, uiAction: uiAction ?? null });

  } catch (e: any) {
    console.error('[POST /api/onboarding/:projectId/message]', e);
    const isOverloaded = e?.status === 529 || e?.error?.error?.type === 'overloaded_error';
    if (isOverloaded) {
      return json({ error: 'AI temporarily busy', reply: 'Se pare că AI-ul este momentan supraîncărcat. Te rog să încerci din nou în câteva secunde.' }, 503);
    }
    return json({ error: 'Internal server error' }, 500);
  }
};
