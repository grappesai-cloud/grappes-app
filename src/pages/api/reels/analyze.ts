// Kick off the reel analysis pipeline.
// Uses @vercel/functions waitUntil so the function returns the id immediately
// while the pipeline keeps running in the background up to maxDuration.

import type { APIRoute } from 'astro';
import { waitUntil } from '@vercel/functions';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { insertAnalysis, setFailed } from '../../../lib/reels/db';
import { runAnalysis } from '../../../lib/reels/pipeline';
import { json } from '../../../lib/api-utils';

// Vercel serverless can run up to 800s on Pro plans — enough for the
// frame-extraction + Whisper + Claude pipeline.
export const config = { maxDuration: 800 } as any;

const Body = z.object({
  blobUrl: z.string().url(),
  blobPathname: z.string(),
  fileName: z.string(),
  fileSizeBytes: z.number().int().positive(),
});

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to start an analysis.' }, 401);

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return json({ error: 'Invalid body' }, 400);

  const id = nanoid(16);
  const { blobUrl, blobPathname, fileName, fileSizeBytes } = parsed.data;

  try {
    await insertAnalysis({
      id,
      userId: user.id,
      blobUrl, blobPathname, fileName, fileSizeBytes,
      progress: { step: 'queued', pct: 0, message: 'Queued' },
    });
  } catch (e: any) {
    console.error('[reels/analyze] insert failed:', e?.message);
    return json({ error: 'Could not register analysis.' }, 500);
  }

  // Run the pipeline in the background. waitUntil keeps the function alive
  // until the promise settles or maxDuration is hit, while the response
  // returns to the client immediately.
  waitUntil((async () => {
    try {
      await runAnalysis(id, blobUrl);
    } catch (e: any) {
      console.error('[reels/analyze] pipeline failed:', e?.message);
      await setFailed(id, e?.message ?? 'Pipeline error');
    }
  })());

  return json({ id });
};
