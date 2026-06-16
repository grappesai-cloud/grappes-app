// ─── Presigned R2 PUT URL for social queue media ───────────────────────────
// Browser PUTs the file straight to R2, then registers it with
// POST /api/social/queue/items. Namespaced per user.

import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { presignPut } from '@lib/r2-blob';
import { json } from '../../../../lib/api-utils';

export const prerender = false;

const ALLOWED = new Set([
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'video/mp4', 'video/quicktime', 'video/webm',
]);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to upload.' }, 401);

  const { pathname, contentType } = (await request.json().catch(() => ({}))) as {
    pathname?: string; contentType?: string;
  };
  if (contentType && !ALLOWED.has(contentType)) {
    return json({ error: `Content type ${contentType} not allowed.` }, 400);
  }
  try {
    const base = (pathname?.split('/').pop() || 'media').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    const key = `social/${user.id}/queue/${nanoid(10)}-${base}`;
    const res = await presignPut(key, contentType);
    return json(res);
  } catch (e: any) {
    console.error('[social/queue/upload] error:', e?.message);
    return json({ error: e?.message ?? 'Upload setup failed.' }, 500);
  }
};
