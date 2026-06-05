// ─── POST /api/social/sync ───────────────────────────────────────────────────
// User-triggered manual sync: pulls accounts + analytics from Zernio into the
// social_* tables. The daily cron does the same for everyone.

import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-utils';
import { checkRateLimit } from '../../../lib/rate-limit';
import { zernioConfigured } from '../../../lib/social/zernio';
import { ingestForUser } from '../../../lib/social/ingest';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!zernioConfigured()) {
    return json({ error: 'Social Lab is not configured (ZERNIO_API_KEY missing).' }, 503);
  }

  if (!checkRateLimit(`social-sync:${user.id}`, 6, 60 * 60 * 1000)) {
    return json({ error: 'Too many syncs this hour. Try again later.' }, 429);
  }

  try {
    const result = await ingestForUser(user.id);
    return json({ ok: true, ...result });
  } catch (err) {
    console.error('[social/sync]', err);
    return json({ error: 'Sync failed.' }, 500);
  }
};
