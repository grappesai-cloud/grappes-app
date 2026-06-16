// POST /api/assets/[projectId]/sign-upload — accepts a project asset (multipart,
// field `file`), stores it in R2 server-side, returns { url, pathname }.
// Project-scoped: the path must stay under assets/<projectId>/ and the project
// must belong to the user. Same-origin POST: no bucket CORS needed.

import type { APIRoute } from 'astro';
import { put } from '@lib/r2-blob';
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

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Invalid upload.' }, 400); }
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);

  // kind from form field or clientPayload (back-compat).
  let kind: 'image' | 'video' | 'zip' = 'image';
  const kindRaw = String(form.get('kind') || '');
  if (['image', 'video', 'zip'].includes(kindRaw)) kind = kindRaw as any;
  else {
    try { const cp = JSON.parse(String(form.get('clientPayload') || '{}')); if (cp.kind) kind = cp.kind; } catch { /* ignore */ }
  }
  if (!['image', 'video', 'zip'].includes(kind)) kind = 'image';

  const pathname = String(form.get('pathname') || '');
  if (!pathname.startsWith(`assets/${projectId}/`)) {
    return json({ error: 'Upload path must be within this project' }, 400);
  }
  const contentType = file.type || String(form.get('contentType') || '');
  if (contentType && !MIME_BY_KIND[kind].includes(contentType)) {
    return json({ error: `Content type ${contentType} not allowed for ${kind}.` }, 400);
  }

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await put(pathname, bytes, { contentType });
    return json({ url: res.url, pathname: res.pathname });
  } catch (err) {
    console.error('[assets/sign-upload] error:', err);
    return json({ error: err instanceof Error ? err.message : 'Upload failed' }, 500);
  }
};
