import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { PAYOUT_THRESHOLD } from '../../../lib/referral';
import { sendReferralPayoutAlert } from '../../../lib/resend';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 3 payout requests/hour per user
  if (!checkRateLimit(`request-payout:${user.id}`, 3, 3_600_000)) {
    return json({ error: 'Too many requests. Please wait before submitting another payout request.' }, 429);
  }

  const client = createAdminClient();
  const { data: userData } = await client
    .from('users').select('email, referral_balance').eq('id', user.id).single();

  if (!userData || (userData.referral_balance ?? 0) < PAYOUT_THRESHOLD) {
    return json({ error: 'Sold insuficient (minim 50€)' }, 400 );
  }

  // Check no pending payout already
  const { data: existing } = await client
    .from('referral_payouts').select('id').eq('referrer_id', user.id).eq('status', 'pending').maybeSingle();
  if (existing) return json({ error: 'Ai deja o cerere în așteptare' }, 400);

  await client.from('referral_payouts').insert({
    referrer_id: user.id,
    amount: userData.referral_balance,
    status: 'pending',
  });

  try {
    const result = await sendReferralPayoutAlert({ referrerEmail: userData.email, amount: userData.referral_balance });
    if (!result.success) console.error('[request-payout] Admin alert email failed:', result.error);
  } catch (e) {
    console.error('[request-payout] Admin alert email error:', e);
  }

  return json({ ok: true });
};
