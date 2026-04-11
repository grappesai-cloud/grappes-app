// ─── Signed Upload URL ──────────────────────────────────────────────────────
// Returns a signed URL that allows the browser to upload directly to Supabase
// Storage, bypassing the serverless function (avoids sharp/timeout issues).

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';

import { json } from '../../../../lib/api-utils';
const BUCKET = 'assets';


export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const body = await request.json();
  const { filename, contentType } = body as { filename: string; contentType: string };

  if (!filename || !contentType) return json({ error: 'filename and contentType required' }, 400);

  // Strict MIME and extension allowlist — prevent arbitrary file uploads
  const ALLOWED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
  const ALLOWED_EXTS = ['png', 'jpg', 'jpeg', 'webp'];
  if (!ALLOWED_MIMES.includes(contentType)) return json({ error: 'Only PNG, JPEG, and WebP images allowed' }, 400);

  const rawExt = filename.split('.').pop()?.toLowerCase() || '';
  const ext = ALLOWED_EXTS.includes(rawExt) ? rawExt : 'jpg';
  const uuid = crypto.randomUUID();
  const storagePath = `${params.projectId}/section/${uuid}.${ext}`;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) {
    console.error('[sign-upload] Error:', error);
    return json({ error: 'Failed to create upload URL' }, 500);
  }

  // Pre-compute public URL
  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return json({
    signedUrl: data.signedUrl,
    token: data.token,
    path: storagePath,
    publicUrl: urlData.publicUrl,
  });
};
