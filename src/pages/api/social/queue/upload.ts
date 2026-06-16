// POST /api/social/queue/upload — accepts social media (multipart, field
// `file`), stores it in R2 server-side, returns { url, pathname }. Namespaced
// per user under `social/<user-id>/queue/...`. Same-origin POST: no CORS.

import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { put } from '@lib/r2-blob';
import { json } from '../../../../lib/api-utils';

export const prerender = false;

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to upload.' }, 401);

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Invalid upload.' }, 400); }
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);

  const contentType = file.type || String(form.get('contentType') || '');
  if (contentType && !ALLOWED.has(contentType)) {
    return json({ error: `Content type ${contentType} not allowed.` }, 400);
  }
  try {
    const base = (file.name || 'media').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    const key = `social/${user.id}/queue/${nanoid(10)}-${base}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await put(key, bytes, { contentType });
    return json({ url: res.url, pathname: res.pathname });
  } catch (e: any) {
    console.error('[social/queue/upload] error:', e?.message);
    return json({ error: e?.message ?? 'Upload failed.' }, 500);
  }
};
