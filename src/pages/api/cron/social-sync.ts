// ─── Cron: daily Zernio ingest for all Social Lab users ──────────────────────
// Runs daily via Vercel Cron (configured in vercel.json). Pulls connected
// accounts + per-post analytics from Zernio into the social_* tables.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { json } from '../../../lib/api-utils';
import { zernioConfigured } from '../../../lib/social/zernio';
import { ingestAllUsers } from '../../../lib/social/ingest';

export const prerender = false;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  // Vercel Cron authenticates with Authorization: Bearer <CRON_SECRET>
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!safeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  if (!zernioConfigured()) {
    console.log('[cron/social-sync] ZERNIO_API_KEY not set — skipping');
    return json({ skipped: true });
  }

  const result = await ingestAllUsers();
  console.log('[cron/social-sync]', result);
  return json(result);
};
