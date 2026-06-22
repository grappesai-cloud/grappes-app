// ─── Admin: deliver a hand-built site (concierge flow) ───────────────────────
// The operator builds the site in Claude Code, then POSTs the finished HTML here.
// It stores the HTML as the project's latest generated_files version, flips the
// project to 'generated' with a working preview, and emails the client.
//
// Auth: x-admin-secret header === ADMIN_SECRET.
// Body: either raw HTML (Content-Type: text/html) or JSON { html, notify? }.
//   curl --data-binary @site.html -H "x-admin-secret: $S" -H "Content-Type: text/html" \
//        -H "Origin: https://grappes.dev" https://grappes.dev/api/admin/projects/<id>/deliver
// Pass ?notify=0 to store without emailing the client.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../../../../lib/db';
import { FULL_PAGE_KEY } from '../../../../../lib/creative-generation';
import { stripFabricatedSrcset } from '../../../../../lib/html-compat';
import { sendSiteReadyEmail } from '../../../../../lib/resend';
import { json } from '../../../../../lib/api-utils';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';

function adminOk(request: Request): boolean {
  const secret = request.headers.get('x-admin-secret') ?? '';
  const adminSecret = import.meta.env.ADMIN_SECRET ?? '';
  if (!adminSecret) return false;
  try {
    return timingSafeEqual(Buffer.from(secret), Buffer.from(adminSecret));
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ request, params, url }) => {
  if (!checkRateLimit(`admin:${getClientIp(request)}`, 60, 3_600_000)) {
    return json({ error: 'Too many requests' }, 429);
  }
  if (!adminOk(request)) return json({ error: 'Unauthorized' }, 401);

  const projectId = params.projectId!;
  const project = await db.projects.findById(projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  // Accept raw HTML body or JSON { html, notify }
  const ct = request.headers.get('content-type') || '';
  let html = '';
  let notify = url.searchParams.get('notify') !== '0';
  if (ct.includes('application/json')) {
    let body: { html?: string; notify?: boolean };
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
    html = typeof body.html === 'string' ? body.html : '';
    if (body.notify === false) notify = false;
  } else {
    html = await request.text();
  }

  html = html.trim();
  if (html.length < 100 || !/<\/html>|<body[\s>]|<!doctype/i.test(html)) {
    return json({ error: 'Provide the full site HTML (raw body or JSON `html`).' }, 400);
  }

  // Store as the latest version, mirroring the generation save path.
  const clean = stripFabricatedSrcset(html);
  const existing = await db.generatedFiles.findLatest(projectId);
  const version = (existing?.version ?? 0) + 1;
  await db.generatedFiles.create({
    project_id: projectId,
    version,
    files: { [FULL_PAGE_KEY]: clean, '__manual_build': 'true' },
    generation_cost: 0,
    generation_tokens: 0,
  });

  await db.projects.update(projectId, { preview_url: `/preview/${projectId}` });
  await db.projects.updateStatus(projectId, 'generated');
  await db.projects.updateSubstatus(projectId, null);

  // Email the client that their site is ready.
  let emailed = false;
  if (notify) {
    try {
      const owner = project.user_id ? await db.users.findById(project.user_id) : null;
      const to = (owner as any)?.email;
      if (to) {
        const r = await sendSiteReadyEmail({ to, siteName: project.name, projectId });
        emailed = r.success;
        if (!r.success) console.error('[deliver] site-ready email not sent:', r.error);
      }
    } catch (e) {
      console.error('[deliver] email failed:', e);
    }
  }

  return json({ ok: true, projectId, version, status: 'generated', preview: `/preview/${projectId}`, emailed });
};
