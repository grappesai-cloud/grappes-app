// Accepts a reel file (multipart/form-data, field `file`) and stores it in
// Cloudflare R2 server-side, then returns { url, pathname }. The browser POSTs
// straight here (same-origin) so there's no bucket CORS / presign dance.

import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { put } from '@lib/r2-blob';
import { json } from '../../../lib/api-utils';

const ALLOWED = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to upload a reel.' }, 401);

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: 'Invalid upload.' }, 400); }
  const file = form.get('file');
  if (!(file instanceof File)) return json({ error: 'No file provided.' }, 400);

  const contentType = file.type || String(form.get('contentType') || '');
  if (contentType && !ALLOWED.has(contentType)) {
    return json({ error: `Content type ${contentType} not allowed.` }, 400);
  }
  try {
    const base = (file.name || 'reel.mp4').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    const key = `reels/${user.id}/${nanoid(10)}-${base}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await put(key, bytes, { contentType });
    return json({ url: res.url, pathname: res.pathname });
  } catch (e: any) {
    console.error('[reels/upload] error:', e?.message);
    return json({ error: e?.message ?? 'Upload failed.' }, 500);
  }
};
