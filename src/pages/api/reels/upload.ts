// Issues a presigned Cloudflare R2 PUT URL for direct browser upload of reel
// files (replaces the Vercel Blob handleUpload flow). The browser PUTs the file
// straight to R2, then confirms via POST /api/reels/analyze.

import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { presignPut } from '@lib/r2-blob';
import { json } from '../../../lib/api-utils';

const ALLOWED = new Set(['video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska']);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to upload a reel.' }, 401);

  const { pathname, contentType } = (await request.json().catch(() => ({}))) as {
    pathname?: string; contentType?: string;
  };
  if (contentType && !ALLOWED.has(contentType)) {
    return json({ error: `Content type ${contentType} not allowed.` }, 400);
  }
  try {
    const base = (pathname?.split('/').pop() || 'reel.mp4').replace(/[^a-zA-Z0-9._-]+/g, '_').slice(-80);
    const key = `reels/${user.id}/${nanoid(10)}-${base}`;
    const res = await presignPut(key, contentType);
    return json(res);
  } catch (e: any) {
    console.error('[reels/upload] error:', e?.message);
    return json({ error: e?.message ?? 'Upload setup failed.' }, 500);
  }
};
