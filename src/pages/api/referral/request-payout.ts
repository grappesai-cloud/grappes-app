import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { PAYOUT_THRESHOLD } from '../../../lib/referral';
import { sendReferralPayoutAlert } from '../../../lib/resend';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 3 payout requests/hour per user
  if (!checkRateLimit(`request-payout:${user.id}`, 3, 3_600_000)) {
    return json({ error: 'Too many requests. Please wait before submitting another payout request.' }, 429);
  }

  let body: any = {};
  try { body = await request.json(); } catch { /* no body: legacy clients */ }
  const ibanRaw = (body?.iban ?? '').toString().trim().replace(/\s+/g, '').toUpperCase();
  const holder  = (body?.holder ?? '').toString().trim().slice(0, 120);

  // Basic IBAN sanity: 2 letters + 2 digits + 11-30 alphanumerics
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(ibanRaw)) {
    return json({ error: 'Invalid IBAN. Use the format e.g. RO00BANK0000000000000000.' }, 400);
  }
  if (holder.length < 2) {
    return json({ error: 'Please provide the account holder name.' }, 400);
  }

  const client = createAdminClient();
  const { data: userData } = await client
    .from('users').select('email, referral_balance').eq('id', user.id).single();

  if (!userData || (userData.referral_balance ?? 0) < PAYOUT_THRESHOLD) {
    return json({ error: 'Insufficient balance (minimum €50).' }, 400);
  }

  // Check no pending payout already
  const { data: existing } = await client
    .from('referral_payouts').select('id').eq('referrer_id', user.id).eq('status', 'pending').maybeSingle();
  if (existing) return json({ error: 'You already have a pending payout request.' }, 400);

  await client.from('referral_payouts').insert({
    referrer_id: user.id,
    amount: userData.referral_balance,
    status: 'pending',
    iban: ibanRaw,
    iban_holder: holder,
  });

  try {
    const result = await sendReferralPayoutAlert({ referrerEmail: userData.email, amount: userData.referral_balance });
    if (!result.success) console.error('[request-payout] Admin alert email failed:', result.error);
  } catch (e) {
    console.error('[request-payout] Admin alert email error:', e);
  }

  return json({ ok: true });
};
