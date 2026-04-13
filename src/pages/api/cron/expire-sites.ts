// ─── Cron: expire free and paid sites past their expiry date ─────────────────
// Runs daily via Vercel Cron (configured in vercel.json).
// Marks projects with billing_status='free' or 'active' as 'expired'
// when their expires_at has passed.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '../../../lib/supabase';

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

  const client = createAdminClient();
  const now = new Date().toISOString();

  // Single atomic UPDATE — no select-then-update, no pagination issues.
  // Returns the updated rows so we can log IDs.
  const { data: expired, error } = await client
    .from('projects')
    .update({ billing_status: 'expired', updated_at: now })
    .in('billing_status', ['free', 'active'])
    .lt('expires_at', now)
    .not('expires_at', 'is', null)
    .select('id');

  if (error) {
    console.error('[cron/expire-sites] Update error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const count = expired?.length ?? 0;
  if (count === 0) {
    console.log('[cron/expire-sites] No sites to expire');
  } else {
    console.log(`[cron/expire-sites] Expired ${count} site(s):`, expired!.map(p => p.id));
  }

  // Cleanup stale rate_limits entries (older than 24 hours)
  let rateLimitsCleaned = 0;
  try {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data: deleted } = await client
      .from('rate_limits')
      .delete()
      .lt('created_at', cutoff)
      .select('id');
    rateLimitsCleaned = deleted?.length ?? 0;
    if (rateLimitsCleaned > 0) {
      console.log(`[cron/expire-sites] Cleaned ${rateLimitsCleaned} stale rate_limit entries`);
    }
  } catch (e) {
    console.warn('[cron/expire-sites] Rate limits cleanup failed (non-fatal):', e);
  }

  return new Response(JSON.stringify({ expired: count, rateLimitsCleaned }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
