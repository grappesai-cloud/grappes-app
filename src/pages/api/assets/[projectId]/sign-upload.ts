// ─── Signed Upload URL ──────────────────────────────────────────────────────
// Returns a signed URL that allows the browser to upload directly to Supabase
// Storage, bypassing the Vercel function body limit (4.5MB on Hobby).
// Supports: images (large), videos, zip archives.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';
import { json } from '../../../../lib/api-utils';

const BUCKET = 'assets';

// Max sizes per kind (enforced server-side via path + later in finalize)
const MAX_BYTES = {
  image:  20 * 1024 * 1024,   //  20 MB — wide margin for raw photographer dumps
  video:  50 * 1024 * 1024,   //  50 MB — short marketing clip
  zip:   200 * 1024 * 1024,   // 200 MB — bulk asset bundle
} as const;

const MIME_BY_KIND: Record<string, { mimes: string[]; exts: string[] }> = {
  image: {
    mimes: ['image/png', 'image/jpeg', 'image/webp', 'image/gif', 'image/svg+xml'],
    exts:  ['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg'],
  },
  video: {
    mimes: ['video/mp4', 'video/webm', 'video/quicktime'],
    exts:  ['mp4', 'webm', 'mov'],
  },
  zip: {
    mimes: ['application/zip', 'application/x-zip-compressed', 'application/x-zip', 'application/octet-stream'],
    exts:  ['zip'],
  },
};

export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }
  const {
    filename,
    contentType,
    kind = 'image',
    size,
    assetType = 'section',
  } = body as {
    filename:    string;
    contentType: string;
    kind?:       'image' | 'video' | 'zip';
    size?:       number;
    assetType?:  string;  // logo|hero|section|og|video|menu|other — used at finalize
  };

  if (!filename || !contentType) return json({ error: 'filename and contentType required' }, 400);
  if (!['image', 'video', 'zip'].includes(kind)) return json({ error: 'kind must be image|video|zip' }, 400);

  const allow = MIME_BY_KIND[kind];
  if (!allow.mimes.includes(contentType.toLowerCase()) && !(kind === 'zip' && filename.toLowerCase().endsWith('.zip'))) {
    return json({ error: `Invalid contentType "${contentType}" for kind "${kind}". Allowed: ${allow.mimes.join(', ')}` }, 400);
  }

  if (typeof size === 'number' && size > MAX_BYTES[kind]) {
    return json({ error: `File too large. Max ${Math.round(MAX_BYTES[kind] / 1024 / 1024)}MB for ${kind}` }, 413);
  }

  const rawExt = filename.split('.').pop()?.toLowerCase() || '';
  const ext = allow.exts.includes(rawExt) ? rawExt : allow.exts[0];
  const uuid = crypto.randomUUID();
  const folder = kind === 'zip' ? '_uploads' : (kind === 'video' ? 'video' : assetType);
  const storagePath = `${params.projectId}/${folder}/${uuid}.${ext}`;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(BUCKET)
    .createSignedUploadUrl(storagePath);

  if (error) {
    console.error('[sign-upload] Error:', error);
    return json({ error: 'Failed to create upload URL' }, 500);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);

  return json({
    signedUrl:  data.signedUrl,
    token:      data.token,
    path:       storagePath,
    publicUrl:  urlData.publicUrl,
    kind,
    assetType,
    maxBytes:   MAX_BYTES[kind],
  });
};
