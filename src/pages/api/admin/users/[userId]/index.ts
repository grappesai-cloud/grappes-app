// GET  /api/admin/users/[userId] — full admin view of one user
// Returns: user row, projects, recent support thread, referral summary

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { json } from '../../../../../lib/api-utils';

export const GET: APIRoute = async ({ cookies, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  const client = createAdminClient();
  const [
    { data: user },
    { data: projects },
    { data: referrals, count: referralCount },
    { data: payouts },
    { data: openThread },
  ] = await Promise.all([
    client.from('users')
      .select('id, email, name, plan, projects_limit, extra_edits, edits_used, edits_period_start, referral_balance, multipage_addon, multipage_addon_lifetime, marketing_opt_out, email_bounced_at, created_at')
      .eq('id', userId).maybeSingle(),
    client.from('projects')
      .select('id, name, status, billing_status, billing_type, expires_at, preview_url, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    client.from('referrals')
      .select('status, amount_earned', { count: 'exact' })
      .eq('referrer_id', userId),
    client.from('referral_payouts')
      .select('id, amount, status, iban, iban_holder, created_at, paid_at')
      .eq('referrer_id', userId)
      .order('created_at', { ascending: false }),
    client.from('support_threads')
      .select('id, status, last_message_at')
      .eq('user_id', userId)
      .eq('status', 'open')
      .maybeSingle(),
  ]);

  if (!user) return json({ error: 'User not found' }, 404);

  return json({
    user,
    projects: projects ?? [],
    referrals: {
      total: referralCount ?? 0,
      confirmed: (referrals ?? []).filter((r: any) => r.status === 'confirmed').length,
      earned: (referrals ?? []).reduce((s: number, r: any) => s + (r.amount_earned ?? 0), 0),
    },
    payouts: payouts ?? [],
    openThread: openThread || null,
  });
};
