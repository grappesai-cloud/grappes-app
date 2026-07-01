// Kick off the reel analysis pipeline.
// Returns the analysis id immediately and runs the pipeline in the background.
// On the long-running Node server (Coolify) a detached promise keeps executing
// after the response is sent, so no serverless waitUntil is needed.

import type { APIRoute } from 'astro';
import { nanoid } from 'nanoid';
import { z } from 'zod';
import { insertAnalysis, setFailed } from '../../../lib/reels/db';
import { runAnalysis } from '../../../lib/reels/pipeline';
import { json } from '../../../lib/api-utils';

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

  // Run the pipeline in the background (detached). The Node server keeps the
  // event loop alive, so this keeps running after the response is returned.
  void (async () => {
    try {
      await runAnalysis(id, blobUrl);
    } catch (e: any) {
      console.error('[reels/analyze] pipeline failed:', e?.message);
      await setFailed(id, e?.message ?? 'Pipeline error');
    }
  })();

  return json({ id });
};
