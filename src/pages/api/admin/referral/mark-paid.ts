// Admin endpoint: mark a referral payout as paid and notify the referrer.
// Usage: POST /api/admin/referral/mark-paid
// Body: { payoutId: string }
// Auth: admin_session cookie (set by /admin login page)

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase';
import { sendPlatformEmailInternal } from '../../../../lib/resend';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { json } from '../../../../lib/api-utils';


function verifyAdminSession(token: string): boolean {
  const secret = import.meta.env.ADMIN_SECRET ?? '';
  if (!secret || !token) return false;
  const dotIdx = token.indexOf('.');
  if (dotIdx === -1) return false;
  const nonce = token.slice(0, dotIdx);
  const sig = token.slice(dotIdx + 1);
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', secret).update(nonce).digest('hex');
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const POST: APIRoute = async ({ request, cookies }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value ?? '')) return json({ error: 'Forbidden' }, 403);

  const { payoutId } = await request.json();
  if (!payoutId) return json({ error: 'payoutId required' }, 400);

  const client = createAdminClient();
  const { data: payout } = await client
    .from('referral_payouts').select('*, users(email)').eq('id', payoutId).single();

  if (!payout) return json({ error: 'Not found' }, 404);
  if (payout.status === 'paid') return json({ error: 'Already paid' }, 400);

  await client.from('referral_payouts').update({
    status: 'paid',
    paid_at: new Date().toISOString(),
  }).eq('id', payoutId);

  // Atomic deduct — prevents race condition if called twice or concurrently
  const { data: newBalanceRaw } = await client.rpc('deduct_referral_balance', {
    p_user_id: payout.referrer_id,
    p_amount: payout.amount,
  });
  const newBalance = (newBalanceRaw as number) ?? 0;

  // Notify referrer
  const referrerEmail = (payout as any).users?.email;
  if (referrerEmail) {
    try {
      const result = await sendPlatformEmailInternal({
        to: referrerEmail,
        subject: `✅ Transfer de ${payout.amount.toFixed(2)}€ procesat — Grappes Referrals`,
        html: `<p style="font-family:sans-serif;font-size:15px;color:#333">Transferul de <strong>${payout.amount.toFixed(2)}€</strong> a fost procesat. Îl vei găsi în contul bancar în 1-3 zile lucrătoare. Mulțumim că recomanzi Grappes!</p>`,
      });
      if (!result.success) console.error('[mark-paid] Payout notification email failed:', result.error);
    } catch (e) {
      console.error('[mark-paid] Payout notification email error:', e);
    }
  }

  return json({ ok: true, newBalance });
};
