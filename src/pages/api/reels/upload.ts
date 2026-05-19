// Vercel Blob client-direct upload token issuer for reel files.
// Browser calls this via @vercel/blob/client's `upload()` helper.

import type { APIRoute } from 'astro';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { nanoid } from 'nanoid';
import { json } from '../../../lib/api-utils';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to upload a reel.' }, 401);

  const body = (await request.json()) as HandleUploadBody;
  try {
    const res = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname: string) => {
        const ext = pathname.split('.').pop() ?? 'mp4';
        const safeName = `${nanoid(12)}.${ext}`;
        return {
          allowedContentTypes: [
            'video/mp4', 'video/quicktime', 'video/webm', 'video/x-matroska',
          ],
          maximumSizeInBytes: 200 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: user.id, safeName }),
          addRandomSuffix: false,
          pathname: `reels/${safeName}`,
        } as any;
      },
      onUploadCompleted: async () => {
        // Pipeline kicks off on /api/reels/analyze after client confirms.
      },
    });
    return json(res);
  } catch (e: any) {
    console.error('[reels/upload] error:', e?.message);
    return json({ error: e?.message ?? 'Upload setup failed.' }, 500);
  }
};
