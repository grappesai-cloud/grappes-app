// ─── Signed Upload URL ──────────────────────────────────────────────────────
// Returns a Vercel Blob client-upload token so the browser can upload directly
// to Blob storage, bypassing the Vercel function body limit.
// Called by the client via `upload()` from `@vercel/blob/client` — that helper
// posts the request body that `handleUpload` expects below.
// Supports: images, videos, zip archives.

import type { APIRoute } from 'astro';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';

// Max sizes per kind
const MAX_BYTES = {
  image:  20 * 1024 * 1024,
  video:  50 * 1024 * 1024,
  zip:   200 * 1024 * 1024,
} as const;

const MIME_BY_KIND: Record<'image' | 'video' | 'zip', { mimes: string[]; exts: string[] }> = {
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

interface ClientPayload {
  kind?: 'image' | 'video' | 'zip';
  assetType?: string;
}

export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const projectId = params.projectId!;
  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let body: HandleUploadBody;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string, clientPayloadStr) => {
        let payload: ClientPayload = {};
        try { if (clientPayloadStr) payload = JSON.parse(clientPayloadStr); } catch { /* ignore */ }
        const kind = (payload.kind && ['image', 'video', 'zip'].includes(payload.kind)) ? payload.kind : 'image';
        const allow = MIME_BY_KIND[kind];
        const assetType = payload.assetType ?? 'section';

        // Choose final pathname: <projectId>/<folder>/<uuid>.<ext>
        const rawExt = pathname.split('.').pop()?.toLowerCase() || '';
        const ext = allow.exts.includes(rawExt) ? rawExt : allow.exts[0];
        const uuid = crypto.randomUUID();
        const folder = kind === 'zip' ? '_uploads' : (kind === 'video' ? 'video' : assetType);
        const finalPathname = `assets/${projectId}/${folder}/${uuid}.${ext}`;

        return {
          allowedContentTypes: allow.mimes,
          maximumSizeInBytes: MAX_BYTES[kind],
          tokenPayload: JSON.stringify({ projectId, kind, assetType, finalPathname }),
          // Override the upload destination so files land at our chosen path.
          addRandomSuffix: false,
          pathname: finalPathname,
        } as any;
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // Hook for post-upload work; currently a no-op (the /finalize endpoint
        // registers the asset row after the client confirms upload). Kept for
        // future webhook-style flows.
        try {
          const meta = tokenPayload ? JSON.parse(tokenPayload) : null;
          console.log('[sign-upload] completed:', { url: blob.url, pathname: blob.pathname, meta });
        } catch { /* ignore */ }
      },
    });
    return json(jsonResponse);
  } catch (err) {
    console.error('[sign-upload] handleUpload error:', err);
    return json({ error: err instanceof Error ? err.message : 'Failed to create upload URL' }, 500);
  }
};
