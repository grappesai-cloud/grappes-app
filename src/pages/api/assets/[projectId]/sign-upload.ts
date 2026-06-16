// ─── Signed Upload URL (Cloudflare R2 presigned PUT) ────────────────────────
// Returns a presigned R2 PUT URL so the browser uploads directly to storage,
// bypassing the function body limit. Project-scoped + kind-validated.
// Client PUTs the file, then registers it via /finalize.

import type { APIRoute } from 'astro';
import { presignPut } from '@lib/r2-blob';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';

const MIME_BY_KIND: Record<'image' | 'video' | 'zip', string[]> = {
  image: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml', 'image/heic', 'image/heif'],
  video: ['video/mp4', 'video/webm', 'video/quicktime'],
  zip: ['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'application/octet-stream'],
};

export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const projectId = params.projectId!;
  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let payload: { pathname?: string; contentType?: string; kind?: 'image' | 'video' | 'zip'; clientPayload?: string };
  try { payload = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  // kind can come directly or inside clientPayload (back-compat with the old upload() call)
  let kind: 'image' | 'video' | 'zip' = payload.kind ?? 'image';
  try { if (payload.clientPayload) { const cp = JSON.parse(payload.clientPayload); if (cp.kind) kind = cp.kind; } } catch { /* ignore */ }
  if (!['image', 'video', 'zip'].includes(kind)) kind = 'image';

  const pathname = payload.pathname ?? '';
  if (!pathname.startsWith(`assets/${projectId}/`)) {
    return json({ error: 'Upload path must be within this project' }, 400);
  }
  if (payload.contentType && !MIME_BY_KIND[kind].includes(payload.contentType)) {
    return json({ error: `Content type ${payload.contentType} not allowed for ${kind}.` }, 400);
  }

  try {
    const res = await presignPut(pathname, payload.contentType);
    return json(res);
  } catch (err) {
    console.error('[sign-upload] presign error:', err);
    return json({ error: err instanceof Error ? err.message : 'Failed to create upload URL' }, 500);
  }
};
