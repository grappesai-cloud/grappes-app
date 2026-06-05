// ─── Vercel Blob client-direct upload token issuer for queue media ──────────
// Browser calls this via @vercel/blob/client's `upload()` helper, then
// registers the file with POST /api/social/queue/items.

import type { APIRoute } from 'astro';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { json } from '../../../../lib/api-utils';

export const prerender = false;

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to upload.' }, 401);

  const body = (await request.json()) as HandleUploadBody;
  try {
    const res = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        return {
          // Keep uploads namespaced per user so the "folder" metaphor holds.
          pathname: `social/${user.id}/queue/${pathname.split('/').pop()}`,
          allowedContentTypes: [
            'image/jpeg', 'image/png', 'image/webp', 'image/gif',
            'video/mp4', 'video/quicktime', 'video/webm',
          ],
          maximumSizeInBytes: 200 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: user.id, pathname }),
          addRandomSuffix: true,
        } as any;
      },
      onUploadCompleted: async () => {
        // Client registers the item via POST /api/social/queue/items.
      },
    });
    return json(res);
  } catch (e: any) {
    console.error('[social/queue/upload] error:', e?.message);
    return json({ error: e?.message ?? 'Upload setup failed.' }, 500);
  }
};
