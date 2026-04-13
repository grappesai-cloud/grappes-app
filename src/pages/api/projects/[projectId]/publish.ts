// ─── Publish endpoint (Phase 2) ──────────────────────────────────────────────
// Pushes the full-page HTML to GitHub and triggers Vercel deployment.
// Simplified: single self-contained HTML file → index.html + minimal config.

// Fluid Compute — no hard timeout (800s safety ceiling)
export const maxDuration = 800;

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { FULL_PAGE_KEY } from '../../../../lib/creative-generation';
import { buildStaticPublishFiles, HTML_KEY_PREFIX } from '../../../../lib/html-compat';
import { buildSiteArchitecture } from '../../../../lib/generation';
import { createOrGetRepo, pushFiles } from '../../../../lib/github';
import {
  triggerGitDeployment,
  getLatestDeployment,
  pollDeploymentUntilDone,
  getProjectProductionUrl,
} from '../../../../lib/vercel-api';
import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';


function repoName(slug: string) {
  return slug.replace(/[^a-z0-9-]/gi, '-').replace(/^-|-$/g, '').toLowerCase() || 'website';
}

export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 5 publish attempts per hour per user
  if (!checkRateLimit(`publish:${user.id}`, 5, 3_600_000)) {
    return json({ error: 'Too many publish attempts. Please wait.' }, 429);
  }

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  if (!['generated', 'live', 'failed', 'deploying'].includes(project.status)) {
    return json({ error: `Cannot publish from status "${project.status}"` }, 409);
  }

  if (project.billing_status === 'expired') {
    return json({ error: 'Your site plan has expired. Please renew to publish.' }, 403);
  }

  await db.projects.updateStatus(params.projectId!, 'deploying');
  await db.projects.updateSubstatus(params.projectId!, 'preparing_files');

  runPublishPipeline(params.projectId!, project.slug).catch(async (e) => {
    console.error('[publish] Unhandled error:', e);
    try {
      await db.projects.updateStatus(params.projectId!, 'failed');
      await db.projects.updateSubstatus(params.projectId!, `err:${((e as Error).message || String(e)).slice(0, 200)}`);
    } catch {}
  });

  return json({ started: true });
};

async function runPublishPipeline(projectId: string, slug: string) {
  const sub = (s: string | null) => db.projects.updateSubstatus(projectId, s);

  // ── Load HTML from DB ──────────────────────────────────────────────────────
  const gen = await db.generatedFiles.findLatest(projectId);
  if (!gen?.files) throw new Error('No generated files');

  const fullHtml = gen.files[FULL_PAGE_KEY] ?? null;

  // Legacy fallback: collect section HTMLs for buildStaticPublishFiles
  const sectionHtmls: Record<string, string> = {};
  for (const [key, value] of Object.entries(gen.files)) {
    if (key.startsWith(HTML_KEY_PREFIX) && key !== FULL_PAGE_KEY) {
      sectionHtmls[key.slice(HTML_KEY_PREFIX.length)] = value;
    }
  }

  if (!fullHtml && Object.keys(sectionHtmls).length === 0) throw new Error('No HTML found');

  const brief = await db.briefs.findByProjectId(projectId);
  if (!brief) throw new Error('Brief not found');

  const arch = buildSiteArchitecture(brief.data);

  // ── Build static files (reuse existing helper) ─────────────────────────────
  // buildStaticPublishFiles handles both full-page and legacy section approaches,
  // and includes favicon, robots.txt, sitemap.xml, vercel.json, inner pages
  const staticFiles = buildStaticPublishFiles({
    fullHtml: fullHtml ?? undefined,
    sectionHtmls,
    arch,
    allFiles: gen.files,
  });

  // ── GitHub ──────────────────────────────────────────────────────────────────
  await sub('creating_repo');
  const name = repoName(slug);
  const freshProject = await db.projects.findById(projectId);
  if (!freshProject) throw new Error('Project not found');

  let githubFullName: string;
  let githubUrl: string;
  try {
    const repo = await createOrGetRepo(name, `Published by WebAI — ${freshProject.name}`);
    githubFullName = repo.fullName;
    githubUrl      = repo.htmlUrl;
  } catch (e) {
    await db.projects.updateStatus(projectId, 'generated');
    await sub(null);
    throw new Error(`GitHub repo failed: ${(e as Error).message}`);
  }

  await sub('pushing_files');
  try {
    await pushFiles(githubFullName, staticFiles, `Publish — ${freshProject.name}`);
  } catch (e) {
    await db.projects.updateStatus(projectId, 'generated');
    await sub(null);
    throw new Error(`GitHub push failed: ${(e as Error).message}`);
  }

  await db.projects.update(projectId, { github_repo: name, github_url: githubUrl });

  // ── Vercel project (static — no framework, no build command) ───────────────
  await sub('creating_vercel_project');
  let vercelProjectId = freshProject.vercel_project_id;
  if (!vercelProjectId) {
    try {
      const vProject = await createStaticProject(name, githubFullName);
      vercelProjectId = vProject.id;
      await db.projects.update(projectId, { vercel_project_id: vProject.id });
    } catch (e) {
      console.warn('[publish] Vercel project creation failed (non-fatal):', e);
    }
  }

  // ── Trigger deployment ─────────────────────────────────────────────────────
  await sub('deploying');
  let vercelDeployId: string | undefined;
  let previewUrl: string | undefined;

  if (vercelProjectId) {
    await new Promise(r => setTimeout(r, 2000));
    const [githubOrg, githubRepo] = githubFullName.split('/');
    const triggered = await triggerGitDeployment(vercelProjectId, name, githubOrg, githubRepo);
    if (triggered) {
      vercelDeployId = triggered.id;
      previewUrl     = triggered.url || undefined;
    } else {
      const auto = await getLatestDeployment(vercelProjectId);
      if (auto) { vercelDeployId = auto.id; previewUrl = auto.url || undefined; }
    }
  }

  // ── Poll until READY ───────────────────────────────────────────────────────
  if (vercelDeployId && vercelProjectId) {
    try {
      const finalDeploy = await pollDeploymentUntilDone(vercelDeployId);
      if (finalDeploy.state === 'READY') {
        const productionUrl = await getProjectProductionUrl(vercelProjectId) ?? finalDeploy.url ?? previewUrl;
        await db.projects.update(projectId, { preview_url: productionUrl });
        await db.projects.updateStatus(projectId, 'live');
        if (freshProject.billing_status === 'free') await db.projects.setFreeExpiry(projectId);
        await sub(null);
        return;
      }
    } catch (e) {
      console.warn('[publish] polling failed:', e);
    }
  }

  // Deployment didn't confirm as READY — stay 'deploying' for webhook to resolve,
  // or revert to 'generated' if no Vercel project exists
  if (!vercelProjectId) {
    console.warn('[publish] No Vercel project — reverting to generated');
    await db.projects.updateStatus(projectId, 'generated');
  } else {
    console.warn('[publish] Polling failed or deployment not ready — staying deploying for webhook');
  }
  await sub(null);
}

// ── Create Vercel project configured for static HTML (no build step) ─────────

async function createStaticProject(name: string, githubFullName: string) {
  const BASE = 'https://api.vercel.com';
  const headers = {
    Authorization: `Bearer ${import.meta.env.VERCEL_TOKEN}`,
    'Content-Type': 'application/json',
  };
  const teamId = import.meta.env.VERCEL_TEAM_ID;
  const qs = teamId ? `?teamId=${teamId}` : '';

  // Check if already exists
  const existing = await fetch(`${BASE}/v9/projects/${encodeURIComponent(name)}${qs}`, { headers });
  if (existing.ok) {
    const d = await existing.json();
    return { id: d.id, name: d.name };
  }

  // Create with no framework + no build command -> Vercel serves static files
  const body = {
    name,
    framework: null,         // static site -- no framework detection
    buildCommand: '',        // no build step
    outputDirectory: '.',    // serve from repo root
    gitRepository: { type: 'github', repo: githubFullName },
  };

  const res = await fetch(`${BASE}/v9/projects${qs}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`Vercel static project creation failed: ${JSON.stringify(err)}`);
  }

  const d = await res.json();
  return { id: d.id, name: d.name };
}
