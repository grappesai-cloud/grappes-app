import type { APIRoute } from 'astro';
import { db } from '../../../../../lib/db';
import {
  injectEffectRuntimes,
  injectAnalytics,
  injectBacklink,
  injectFormHandler,
  SONNET_MODEL,
  SONNET_INPUT_COST,
  SONNET_OUTPUT_COST,
} from '../../../../../lib/creative-generation';

import { json } from '../../../../../lib/api-utils';
// Each inner page generation can take up to 4 min
export const maxDuration = 300;


export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  if (project.status !== 'generated') {
    return json({ error: 'Project not in generated state' }, 409);
  }

  // Inner pages require an active site billing (home page was free)
  if (project.billing_status !== 'active') {
    return json({ error: 'site_not_activated', upgradeUrl: `/dashboard/${params.projectId}` }, 403);
  }

  const genFile = await db.generatedFiles.findLatest(params.projectId!);
  if (!genFile?.files?.['__multipage_manifest']) {
    return json({ error: 'No multi-page manifest found' }, 400);
  }

  const manifest: Array<{ slug: string; filename: string; title: string }> = JSON.parse(
    genFile.files['__multipage_manifest']
  );
  const done: Array<{ slug: string; filename: string; title: string }> = genFile.files['__multipage']
    ? JSON.parse(genFile.files['__multipage'])
    : [];

  // Find next page to generate
  const doneFilenames = new Set(done.map(p => p.filename));
  const nextPage = manifest.find(p => !doneFilenames.has(p.filename));

  if (!nextPage) {
    return json({ allDone: true, doneCount: manifest.length, total: manifest.length, pageTitle: null });
  }

  const brief = await db.briefs.findByProjectId(params.projectId!);
  if (!brief) return json({ error: 'Brief not found' }, 400);

  const allPageNames = manifest.map(p => p.title);
  const pageIndex = manifest.findIndex(p => p.filename === nextPage.filename);

  // Get home page HTML for design reference
  const homeHtml = genFile.files['__page__index.html'] || '';
  const { generateOnePage, extractDesignRef } = await import('../../../../../lib/multipage-generation');
  const homeDesignRef = homeHtml ? extractDesignRef(homeHtml) : '';

  // Load project assets for the prompt (hero images, logos, etc.)
  const rawAssets = await db.assets.findByProject(params.projectId!);
  const assetData = rawAssets
    .filter((a: any) => a.public_url)
    .map((a: any) => ({ type: a.type, url: a.public_url, sectionId: a.metadata?.sectionId, variants: a.metadata?.variants }));

  console.log(`[continue] Generating page ${pageIndex + 1}/${manifest.length}: ${nextPage.title} for project ${params.projectId}`);

  let result;
  try {
    result = await generateOnePage({
      brief: brief.data,
      assets: assetData,
      allPages: allPageNames,
      pageIndex,
      homeDesignRef,
    });
  } catch (e) {
    console.error('[continue] generateOnePage failed:', e);
    return json({ error: 'Page generation failed' }, 500);
  }

  // Post-process: auto-fix + inject scripts
  let html = result.page.html;
  try {
    const { autoFix } = await import('../../../../../lib/auto-fix');
    html = autoFix(html, params.projectId!).html;
  } catch {}
  html = injectEffectRuntimes(html);
  html = injectAnalytics(html, brief.data, params.projectId!);
  html = injectBacklink(html, { brandingRemoved: !!(project as any).branding_removed });
  html = injectFormHandler(html, params.projectId!);
  result.page.html = html;

  // Update done list + save new page into existing record
  const newDone = [...done, { slug: result.page.slug, filename: result.page.filename, title: result.page.title }];
  const updatedFiles = {
    ...genFile.files,
    [`__page__${result.page.filename}`]: result.page.html,
    '__multipage': JSON.stringify(newDone),
  };
  await db.generatedFiles.update(genFile.id, { files: updatedFiles });

  // Record cost
  const cost = result.tokens.input * SONNET_INPUT_COST + result.tokens.output * SONNET_OUTPUT_COST;
  await db.costs.create({
    project_id: params.projectId!,
    type: 'generation',
    model: SONNET_MODEL,
    input_tokens: result.tokens.input,
    output_tokens: result.tokens.output,
    cost_usd: cost,
  });

  const allDone = newDone.length >= manifest.length;
  console.log(`[continue] ${nextPage.title} done. ${allDone ? 'All pages complete!' : `${manifest.length - newDone.length} remaining.`}`);

  return json({
    allDone,
    doneCount: newDone.length,
    total: manifest.length,
    pageTitle: nextPage.title,
  });
};
