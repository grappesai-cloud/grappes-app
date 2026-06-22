// ─── Admin: read stored generated HTML (debug) ───────────────────────────────
// TEMPORARY debug endpoint. Returns the latest stored full-page HTML for a
// project so an admin can inspect generation output (e.g. a desktop rendering
// bug) without the owner's session. Guarded by x-admin-secret === ADMIN_SECRET.
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../../../../lib/db';
import { FULL_PAGE_KEY } from '../../../../../lib/html-compat';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';

export const GET: APIRoute = async ({ request, params, url }) => {
  if (!checkRateLimit(`admin:${getClientIp(request)}`, 30, 3_600_000)) {
    return new Response('Too many requests', { status: 429 });
  }
  const secret = request.headers.get('x-admin-secret') ?? '';
  const adminSecret = import.meta.env.ADMIN_SECRET ?? '';
  const ok = adminSecret !== '' && (() => {
    try { return timingSafeEqual(Buffer.from(secret), Buffer.from(adminSecret)); } catch { return false; }
  })();
  if (!ok) return new Response('Unauthorized', { status: 401 });

  const gen = await db.generatedFiles.findLatest(params.projectId!);
  if (!gen?.files) return new Response('No generated files', { status: 404 });

  if (url.searchParams.has('meta')) {
    const keys = Object.keys(gen.files);
    const full = gen.files[FULL_PAGE_KEY] ?? '';
    return new Response(JSON.stringify({
      keys,
      hasFullPage: !!gen.files[FULL_PAGE_KEY],
      fullPageBytes: full.length,
      isMultiPage: !!gen.files['__multipage'],
    }, null, 2), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }

  const html = gen.files[FULL_PAGE_KEY];
  if (!html) return new Response('No full-page HTML stored', { status: 404 });
  return new Response(html, { status: 200, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
