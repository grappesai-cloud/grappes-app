// ─── Publish endpoint ────────────────────────────────────────────────────────
// Marks a delivered site live and records its self-hosted preview URL. The
// public /preview route streams the stored HTML, gated by a share token.

import type { APIRoute } from 'astro';
import { createHmac } from 'node:crypto';
import { db } from '../../../../lib/db';
import { FULL_PAGE_KEY } from '../../../../lib/creative-generation';
import { HTML_KEY_PREFIX } from '../../../../lib/html-compat';
import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';

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

  await db.projects.updateStatus(params.projectId!, 'deploying');
  await db.projects.updateSubstatus(params.projectId!, 'preparing_files');

  runPublishPipeline(params.projectId!).catch(async (e) => {
    console.error('[publish] Unhandled error:', e);
    try {
      await db.projects.updateStatus(params.projectId!, 'failed');
      await db.projects.updateSubstatus(params.projectId!, `err:${((e as Error).message || String(e)).slice(0, 200)}`);
    } catch {}
  });

  return json({ started: true });
};

async function runPublishPipeline(projectId: string) {
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

  // ── Self-hosted publish (no Vercel) ────────────────────────────────────────
  // The platform hosts generated sites itself: the public /preview route streams
  // the stored HTML, gated by a share token. "Publish" just marks the site live
  // and records that self-hosted URL — removing the hard dependency on Vercel
  // deployments + GitHub (which broke once we left the paused Vercel account).
  {
    await sub('publishing');
    const freshProject = await db.projects.findById(projectId);
    if (!freshProject) throw new Error('Project not found');
    const secret =
      import.meta.env.SHARE_TOKEN_SECRET ??
      import.meta.env.SUPABASE_SERVICE_ROLE_KEY ??
      process.env.SHARE_TOKEN_SECRET;
    if (!secret) throw new Error('SHARE_TOKEN_SECRET not configured');
    const token = createHmac('sha256', secret).update(`share:${projectId}`).digest('hex').slice(0, 24);
    const base = (import.meta.env.PUBLIC_SITE_URL ?? process.env.PUBLIC_SITE_URL ?? 'https://grappes.dev').replace(/\/$/, '');
    await db.projects.update(projectId, { preview_url: `${base}/preview/${projectId}?token=${token}` });
    await db.projects.updateStatus(projectId, 'live');
    await sub(null);
    return;
  }
}
