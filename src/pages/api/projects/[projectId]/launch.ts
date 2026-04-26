import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { log } from '../../../../lib/logger';
import { checkRateLimit, checkPersistentRateLimit, recordPersistentRateLimit } from '../../../../lib/rate-limit';
import { applySmartDefaults } from '../../../../lib/onboarding';
import {
  generateSite,
  grammarCheckHtml,
  injectEffectRuntimes,
  injectAnalytics,
  injectBookingWidget,
  injectBacklink,
  injectFormHandler,
  applyBriefContent,
  FULL_PAGE_KEY,
  SONNET_MODEL,
  type AssetData,
} from '../../../../lib/creative-generation';
import { runStructuralQA } from '../../../../lib/structural-qa';
import { INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN } from '../../../../lib/anthropic';

import { json } from '../../../../lib/api-utils';
// Vercel Fluid Compute — up to 800s
export const maxDuration = 800;


// ── GET — poll status ──────────────────────────────────────────────────────────

// If a generation has been stuck for > 10 min, the Lambda died — auto-reset to failed
const STALE_GENERATION_MS = 10 * 60 * 1000;

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  // Auto-recover stale generations (Lambda died without updating status)
  if (project.status === 'generating' && project.updated_at) {
    const age = Date.now() - new Date(project.updated_at).getTime();
    if (age > STALE_GENERATION_MS) {
      console.warn(`[launch] Stale generation detected for ${params.projectId} (${Math.round(age / 60000)}min) — resetting to failed`);
      await db.projects.updateStatus(params.projectId!, 'failed');
      await db.projects.updateSubstatus(params.projectId!, null);
      return json({ status: 'failed', substatus: null, previewUrl: null, githubUrl: null });
    }
  }

  // Check multi-page continuation progress and generation warnings
  let multiPageProgress = null;
  let generationWarnings: string[] | null = null;
  if (project.status === 'generated') {
    try {
      const genFiles = await db.generatedFiles.findLatest(params.projectId!);
      if (genFiles?.files) {
        if (genFiles.files['__multipage_manifest']) {
          const manifest: Array<{ slug: string; filename: string; title: string }> = JSON.parse(genFiles.files['__multipage_manifest']);
          const done: Array<{ slug: string }> = genFiles.files['__multipage']
            ? JSON.parse(genFiles.files['__multipage'])
            : [];
          if (done.length < manifest.length) {
            multiPageProgress = { total: manifest.length, done: done.length };
          }
        }
        if (genFiles.files['__generation_warnings']) {
          generationWarnings = JSON.parse(genFiles.files['__generation_warnings']);
        }
      }
    } catch {}
  }

  return json({
    status: project.status,
    substatus: project.substatus ?? null,
    previewUrl: project.preview_url ?? null,
    githubUrl: project.github_url ?? null,
    multiPageProgress,
    warnings: generationWarnings,
  });
};

// ── POST — fire generation pipeline ───────────────────────────────────────────

export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  // Rate limit generation attempts per hour (each costs ~$0.10–0.50 in AI)
  // Owner plan: unlimited — skip rate limit entirely
  // Paid plans: 10/hour, Free: 3/hour
  const dbUser = await db.users.findById(user.id);
  const userPlan = dbUser?.plan ?? 'free';
  const launchRateKey = `launch:${user.id}`;
  if (userPlan !== 'owner') {
    const maxLaunches = ['pro', 'agency'].includes(userPlan) ? 10 : userPlan === 'starter' ? 5 : 3;
    if (!(await checkPersistentRateLimit(launchRateKey, maxLaunches, 3_600_000))) {
      return json({ error: 'Too many generation requests. Please wait before trying again.' }, 429);
    }
  }

  // Auto-confirm brief if still in onboarding (user clicked Generate directly)
  if (project.status === 'onboarding') {
    try {
      const brief = await db.briefs.findByProjectId(params.projectId!);
      if (brief) {
        const { applySmartDefaults, calculateCompleteness } = await import('../../../../lib/onboarding');
        const enriched = applySmartDefaults(brief.data);
        await db.briefs.update(params.projectId!, enriched, calculateCompleteness(enriched));
        if (!brief.confirmed) await db.briefs.confirm(params.projectId!);
      }
      await db.projects.updateStatus(params.projectId!, 'brief_ready');
    } catch (e) {
      console.warn('[launch] Auto-confirm failed (non-blocking):', e);
    }
  }

  // Multi-page requires active billing
  const brief = await db.briefs.findByProjectId(params.projectId!);
  const isMultiPageRequest = brief?.data?.preferences?.websiteType === 'multi-page';
  if (isMultiPageRequest && project.billing_status !== 'active') {
    return json({ error: 'Multi-page websites require an active plan. Please upgrade.' }, 403);
  }

  // Brief completeness gate — very thin briefs produce mediocre output
  if (brief && (brief.completeness ?? 0) < 0.3) {
    return json({
      error: `Your site brief is only ${Math.round((brief.completeness ?? 0) * 100)}% complete. Please answer more onboarding questions before generating.`,
    }, 422);
  }

  // Atomic status transition — prevents double generation race condition
  const { createAdminClient } = await import('../../../../lib/supabase');
  const supabase = createAdminClient();
  const { data: locked } = await supabase
    .from('projects')
    .update({ status: 'generating', substatus: 'confirming_brief', updated_at: new Date().toISOString() })
    .eq('id', params.projectId!)
    .in('status', ['onboarding', 'brief_ready', 'generated', 'failed'])
    .select('id')
    .maybeSingle();

  if (!locked) {
    // Re-read current status — original `project.status` may be stale
    const current = await db.projects.findById(params.projectId!);
    if (current?.status === 'generating') return json({ started: true, alreadyRunning: true });
    return json({ error: `Cannot launch from status "${current?.status || project.status}"` }, 409);
  }

  // ── Run pipeline synchronously (Vercel Fluid Compute — up to 800s) ──────
  let pipelineWarnings: string[] = [];
  try {
    pipelineWarnings = await runPipeline(params.projectId!);
  } catch (e: any) {
    const errMsg = (e?.message || String(e)).slice(0, 200);
    const isAnthropicRateLimit = e?.status === 429 || e?.error?.error?.type === 'rate_limit_error';
    console.error('[launch] Pipeline error:', errMsg, e?.stack?.split('\n').slice(0, 5).join('\n'));
    try {
      await db.projects.updateStatus(params.projectId!, 'failed');
      await db.projects.updateSubstatus(params.projectId!, `err:${errMsg}`);
    } catch {}
    // Don't record rate limit on failure — failed attempts shouldn't consume slots
    return json({
      error: isAnthropicRateLimit
        ? 'AI provider is temporarily overloaded. Please try again in a few minutes.'
        : errMsg,
    }, isAnthropicRateLimit ? 503 : 500);
  }

  // Record rate limit ONLY on success — failed attempts get a free retry
  if (userPlan !== 'owner') {
    await recordPersistentRateLimit(launchRateKey);
  }

  return json({
    started: true,
    status: 'generated',
    warnings: pipelineWarnings.length > 0 ? pipelineWarnings : undefined,
  });
};

// ── Pipeline ───────────────────────────────────────────────────────────────────

async function runPipeline(projectId: string) {
  const sub = (s: string | null) => db.projects.updateSubstatus(projectId, s);
  const projectRow = await db.projects.findById(projectId);
  const brandingRemoved = !!(projectRow as any)?.branding_removed;

  // ── Step 1: Load brief + assets from DB ─────────────────────────────────
  await sub('confirming_brief');
  const brief = await db.briefs.findByProjectId(projectId);

  if (brief && !brief.confirmed) {
    const withDefaults = applySmartDefaults(brief.data);
    await db.briefs.update(projectId, withDefaults, brief.completeness);
    await db.briefs.confirm(projectId);
  }

  // Merge uploaded assets into brief
  await sub('merging_assets');
  const rawAssets = await db.assets.findByProject(projectId);
  const assetData: AssetData[] = [];

  if (rawAssets.length > 0) {
    const mergeMap: Record<string, any> = {};
    for (const asset of rawAssets) {
      if (!asset.public_url) continue;

      const variants = asset.metadata?.variants as Record<string, string> | undefined;

      if (asset.type === 'logo') {
        mergeMap['branding.logo'] = asset.public_url;
        assetData.push({ type: 'logo', url: asset.public_url });
      }
      if (asset.type === 'hero') {
        mergeMap['media.heroImage'] = asset.public_url;
        assetData.push({ type: 'hero', url: asset.public_url, variants });
      }
      if (asset.type === 'og') {
        mergeMap['media.ogImage'] = asset.public_url;
        assetData.push({ type: 'og', url: asset.public_url });
      }
      if (asset.type === 'favicon') {
        mergeMap['media.favicon'] = asset.public_url;
      }
      if (asset.type === 'video') {
        mergeMap['media.videoUrl'] = asset.public_url;
        const playMode = asset.metadata?.playMode as string | undefined;
        if (playMode) mergeMap['media.videoPlayMode'] = playMode;
      }
      if (asset.type === 'section' && asset.metadata?.sectionId) {
        const fresh = await db.briefs.findByProjectId(projectId);
        const sectionImages = { ...(fresh?.data?.media?.sectionImages ?? {}) };
        sectionImages[asset.metadata.sectionId] = asset.public_url;
        mergeMap['media.sectionImages'] = sectionImages;
        assetData.push({
          type: 'section',
          url: asset.public_url,
          sectionId: asset.metadata.sectionId as string,
          variants,
        });
      }
    }
    if (Object.keys(mergeMap).length > 0) await db.briefs.merge(projectId, mergeMap);
  }

  // ── Step 2: Update project status to 'generating' ───────────────────────
  await sub('generating_site');

  const freshBrief = await db.briefs.findByProjectId(projectId);
  if (!freshBrief) throw new Error('Brief not found after confirmation');

  // Load raw conversation as backup — if brief is thin, Opus/Sonnet reads the conversation directly
  const conversation = await db.conversations.findByProjectId(projectId);
  const rawConversation = (conversation?.messages ?? [])
    .filter((m: any) => m.role === 'user')
    .map((m: any) => m.content)
    .join('\n\n');

  const briefDataSize = JSON.stringify(freshBrief.data).length;
  console.log(`[launch] Brief data keys: ${Object.keys(freshBrief.data ?? {}).join(', ') || 'EMPTY'}`);
  console.log(`[launch] Brief completeness: ${(freshBrief.completeness * 100).toFixed(0)}%`);
  console.log(`[launch] Business name: ${freshBrief.data?.business?.name || 'NOT SET'}`);
  console.log(`[launch] Brief data size: ${briefDataSize} chars`);
  console.log(`[launch] Raw conversation length: ${rawConversation.length} chars`);

  // ── Step 3: Generate site (single-page or multi-page) ───────────────────
  const locale = freshBrief.data?.business?.locale ??
    freshBrief.data?.language ?? 'en';

  const isMultiPage = freshBrief.data?.preferences?.websiteType === 'multi-page';
  let html: string;
  let multiPageFiles: Array<{ slug: string; filename: string; title: string; html: string }> | null = null;
  let multiPageManifest: Array<{ slug: string; filename: string; title: string }> | null = null;
  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let totalCost = 0;
  const generationWarnings: string[] = [];

  if ((freshBrief.completeness ?? 0) < 0.5) {
    generationWarnings.push(`Brief is only ${Math.round((freshBrief.completeness ?? 0) * 100)}% complete — site may lack personality and detail.`);
  }

  try {
    if (isMultiPage) {
      // Generate ALL pages in this pipeline call — no frontend dependency, no /launch/continue needed.
      // Multi-page requires billing_status === 'active' (enforced in onboarding + launch gate above).
      const { generateOnePage, getPagesList, extractDesignRef } = await import('../../../../lib/multipage-generation');
      const { autoFix: autoFixPage } = await import('../../../../lib/auto-fix');
      const allPageNames = (freshBrief.data?.content?.pages as string[] | undefined)
        || ['Home', 'About', 'Services', 'Contact'];

      multiPageFiles = [];
      let homeHtml = '';
      // generationWarnings is declared in outer scope

      for (let pageIdx = 0; pageIdx < allPageNames.length; pageIdx++) {
        await sub(`generating_page_${pageIdx + 1}_of_${allPageNames.length}`);
        console.log(`[launch] Multi-page: generating page ${pageIdx + 1}/${allPageNames.length} — ${allPageNames[pageIdx]}`);

        try {
          const pageResult = await generateOnePage({
            brief: freshBrief.data,
            assets: assetData,
            allPages: allPageNames,
            pageIndex: pageIdx,
            homeDesignRef: homeHtml ? extractDesignRef(homeHtml) : '',
          });

          // Post-process each page individually
          let pageHtml = autoFixPage(pageResult.page.html, projectId).html;
          const pageBriefResult = applyBriefContent(pageHtml, freshBrief.data);
          pageHtml = pageBriefResult.html;
          pageHtml = injectEffectRuntimes(pageHtml);
          pageHtml = injectAnalytics(pageHtml, freshBrief.data, projectId);
          pageHtml = injectBookingWidget(pageHtml, freshBrief.data);
          pageHtml = injectBacklink(pageHtml, { brandingRemoved });
          pageHtml = injectFormHandler(pageHtml, projectId);

          if (pageIdx === 0) homeHtml = pageHtml;

          // Detect truncated inner pages (got forced closing tags)
          if (pageIdx > 0 && pageResult.page.html.endsWith('\n</body>\n</html>')) {
            generationWarnings.push(`Page "${allPageNames[pageIdx]}" was truncated and may be incomplete.`);
          }

          multiPageFiles.push({ ...pageResult.page, html: pageHtml });
          totalInputTokens += pageResult.tokens.input;
          totalOutputTokens += pageResult.tokens.output;
          totalCost += pageResult.cost;
        } catch (pageErr) {
          console.error(`[launch] Multi-page: page ${pageIdx + 1} (${allPageNames[pageIdx]}) failed — skipping:`, pageErr);
          // Home page (index 0) is mandatory — fail the whole generation if it fails
          if (pageIdx === 0) throw pageErr;
          // Inner pages: skip and continue so partial results are saved
          generationWarnings.push(`Page "${allPageNames[pageIdx]}" failed to generate and was skipped.`);
        }
      }
      // Must have at least home page
      if (multiPageFiles.length === 0) throw new Error('No pages were generated successfully');

      html = homeHtml;
      multiPageManifest = getPagesList(freshBrief.data);
      console.log(`[launch] Multi-page: all ${allPageNames.length} pages generated`);
    } else {
      const result = await generateSite({
        projectId,
        brief: freshBrief.data,
        assets: assetData,
        locale,
        rawConversation,
      });
      html = result.html;
      totalInputTokens = result.tokens.input;
      totalOutputTokens = result.tokens.output;
      totalCost = result.cost;
      if (result.opusPlanFailed) {
        console.warn(`[launch] Opus creative plan failed — site generated without creative direction (quality may be lower)`);
        generationWarnings.push('Creative planning step failed. The site was generated without creative direction and may have lower visual quality. Re-generating may produce better results.');
      }
    }
  } catch (e) {
    await db.projects.updateStatus(projectId, 'failed');
    await sub(null);
    throw e;
  }

  // ── QA: Auto-fix + inject scripts ───────────────────────────────────────
  // Skipped for multi-page: each page was post-processed individually in the loop above.
  await sub('auto_fix');
  if (!isMultiPage) {
    const { autoFix } = await import('../../../../lib/auto-fix');
    const autoFixResult = autoFix(html, projectId);
    html = autoFixResult.html;
    if (autoFixResult.fixes.length > 0) {
      console.log(`[launch] Auto-fix: ${autoFixResult.fixes.join(', ')}`);
    }
    // Apply sacred brief content (exact titles, contact, testimonials)
    const briefContentResult = applyBriefContent(html, freshBrief.data);
    html = briefContentResult.html;
    if (briefContentResult.fixes.length > 0) {
      console.log(`[launch] Brief content applied: ${briefContentResult.fixes.join(', ')}`);
    }
    html = injectEffectRuntimes(html);
    html = injectAnalytics(html, freshBrief.data, projectId);
    html = injectBookingWidget(html, freshBrief.data);
    html = injectBacklink(html, { brandingRemoved });
    html = injectFormHandler(html, projectId);
  }

  // ── Grammar check (Haiku, ~3s, only for non-English) ────────────────────
  if (locale !== 'en') {
    try {
      const gc = await grammarCheckHtml({ html, locale });
      if (gc.corrections > 0) {
        html = gc.html;
        totalInputTokens += gc.inputTokens;
        totalOutputTokens += gc.outputTokens;
        totalCost += gc.inputTokens * INPUT_COST_PER_TOKEN + gc.outputTokens * OUTPUT_COST_PER_TOKEN;
        console.log(`[launch] Grammar check: ${gc.corrections} correction(s) in ${locale}`);
      }
    } catch (e) {
      console.warn('[launch] Grammar check failed (non-blocking):', e);
    }
    // Grammar check inner pages too
    if (multiPageFiles) {
      for (const page of multiPageFiles) {
        try {
          const pgc = await grammarCheckHtml({ html: page.html, locale });
          if (pgc.corrections > 0) {
            page.html = pgc.html;
            totalInputTokens += pgc.inputTokens;
            totalOutputTokens += pgc.outputTokens;
            totalCost += pgc.inputTokens * INPUT_COST_PER_TOKEN + pgc.outputTokens * OUTPUT_COST_PER_TOKEN;
            console.log(`[launch] Grammar check (${page.title}): ${pgc.corrections} correction(s)`);
          }
        } catch (pe) {
          console.warn(`[launch] Grammar check failed for ${page.title} (non-blocking):`, pe);
        }
      }
    }
  }

  // Structural QA (in-memory, instant)
  const structuralReport = runStructuralQA(html);
  const allIssues = structuralReport.checks.filter(c => !c.passed).map(c => `[structural] ${c.name}: ${c.message}`);

  // ── Step 8: Save to DB as FULL_PAGE_KEY ─────────────────────────────────
  const existingGen = await db.generatedFiles.findLatest(projectId);
  const version = (existingGen?.version ?? 0) + 1;

  const files: Record<string, string> = {
    [FULL_PAGE_KEY]: html,
    '__structural-qa.json': JSON.stringify(structuralReport, null, 2),
    '__qa_status': allIssues.length === 0 ? 'passed' : 'failed',
  };

  // Store multi-page files
  if (multiPageFiles && multiPageFiles.length >= 1) {
    for (const page of multiPageFiles) {
      files[`__page__${page.filename}`] = page.html;
    }
    files['__multipage'] = JSON.stringify(
      multiPageFiles.map(p => ({ slug: p.slug, filename: p.filename, title: p.title }))
    );
  }
  // Store full manifest so /launch/continue can generate inner pages
  if (multiPageManifest) {
    files['__multipage_manifest'] = JSON.stringify(multiPageManifest);
  }

  // Store generation warnings (truncated/skipped pages, opus plan failure, etc.)
  if (generationWarnings.length > 0) {
    files['__generation_warnings'] = JSON.stringify(generationWarnings);
  }

  await db.generatedFiles.create({
    project_id: projectId,
    version,
    files,
    generation_cost: totalCost,
    generation_tokens: totalInputTokens + totalOutputTokens,
  });

  await db.costs.create({
    project_id: projectId,
    type: 'generation',
    model: SONNET_MODEL,
    input_tokens: totalInputTokens,
    output_tokens: totalOutputTokens,
    cost_usd: totalCost,
  });

  // ── Step 9: Update project status ───────────────────────────────────────
  await db.projects.update(projectId, {
    preview_url: `/preview/${projectId}`,
  });
  await db.projects.updateStatus(projectId, 'generated');
  await sub(null);

  return generationWarnings;
}
