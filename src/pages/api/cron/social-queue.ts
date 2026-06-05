// ─── Cron: hourly autopost queue processor ───────────────────────────────────
// For each active Social Lab queue: caption the next queued media item with
// AI and schedule it via Zernio at the next slot (cadence + posting window).

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json } from '../../../lib/api-utils';
import { zernioConfigured } from '../../../lib/social/zernio';
import { processAllQueues } from '../../../lib/social/queue';

export const prerender = false;
// Captioning N queues × (image describe + caption) can take a while.
export const config = { maxDuration: 300 } as any;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!safeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!zernioConfigured()) {
    console.log('[cron/social-queue] ZERNIO_API_KEY not set — skipping');
    return json({ skipped: true });
  }

  const result = await processAllQueues();
  console.log('[cron/social-queue]', result);
  return json(result);
};
