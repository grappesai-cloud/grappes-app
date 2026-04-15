// ─── Cron: expire free and paid sites past their expiry date ─────────────────
// Runs daily via Vercel Cron (configured in vercel.json).
// Marks projects with billing_status='free' or 'active' as 'expired'
// when their expires_at has passed.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '../../../lib/supabase';
import { sendTrialExpiredEmail } from '../../../lib/resend';

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
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

  // Single atomic UPDATE — no select-then-update, no pagination issues.
  // Returns the updated rows so we can deploy the expired placeholder.
  const { data: expired, error } = await client
    .from('projects')
    .update({ billing_status: 'expired', updated_at: now })
    .in('billing_status', ['free', 'active'])
    .lt('expires_at', now)
    .not('expires_at', 'is', null)
    .select('id, name, vercel_project_id, user_id');

  if (error) {
    console.error('[cron/expire-sites] Update error:', error);
    return new Response(JSON.stringify({ error: error.message }), { status: 500 });
  }

  const count = expired?.length ?? 0;
  if (count === 0) {
    console.log('[cron/expire-sites] No sites to expire');
  } else {
    console.log(`[cron/expire-sites] Expired ${count} site(s):`, expired!.map(p => p.id));

    // Swap each expired site's production deployment for a redirect to
    // grappes.dev/expired?site=<id>. Keeps the Vercel project intact so the
    // real HTML can be redeployed when the user pays.
    const { deployExpiredPlaceholder } = await import('../../../lib/vercel-api');
    const results = await Promise.allSettled(
      expired!.map(async (p: any) => {
        if (!p.vercel_project_id) return { id: p.id, ok: false, error: 'no_vercel_project_id' };
        const redirectUrl = `${siteUrl}/expired?site=${encodeURIComponent(p.id)}`;
        const projectNameSafe = (p.name || 'grappes-site').toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 52) || 'grappes-site';
        const res = await deployExpiredPlaceholder(p.vercel_project_id, projectNameSafe, redirectUrl, p.name || 'site');
        return { id: p.id, ...res };
      })
    );
    results.forEach((r, i) => {
      if (r.status === 'fulfilled' && !r.value.ok) {
        console.warn('[cron/expire-sites] Placeholder deploy failed for', expired![i].id, ':', r.value.error);
      } else if (r.status === 'rejected') {
        console.warn('[cron/expire-sites] Placeholder deploy threw for', expired![i].id, ':', r.reason);
      }
    });

    // Send "trial expired" notification emails
    for (const p of expired!) {
      try {
        if (!p.user_id) continue;
        const { data: userRow } = await client
          .from('users')
          .select('email')
          .eq('id', p.user_id)
          .maybeSingle();
        if (userRow?.email) {
          await sendTrialExpiredEmail({
            to: userRow.email,
            siteName: p.name ?? 'Site-ul tău',
          });
        }
      } catch (e) {
        console.error(`[cron/expire-sites] Expired email failed for project ${p.id}:`, e);
      }
    }
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
