// ── Referral system ──────────────────────────────────────────────────────────
// Rewards: starter=15€/10 subs, pro=10€/conversion, agency=40€/conversion
// Payout: auto-notify admin at every 50€ increment

import { createAdminClient } from './supabase';

export const REFERRAL_REWARDS = {
  starter_batch: 15,       // EUR per 10 monthly conversions
  starter_batch_size: 10,
  pro: 10,                 // EUR per annual conversion
  agency: 40,              // EUR per lifetime conversion
} as const;

export const PAYOUT_THRESHOLD = 50; // EUR

export function generateReferralCode(): string {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
}

/** Returns existing code or generates a new unique one */
export async function ensureReferralCode(userId: string): Promise<string> {
  const client = createAdminClient();
  const { data: user } = await client
    .from('users').select('referral_code').eq('id', userId).single();
  if (user?.referral_code) return user.referral_code;

  let code = '';
  for (let i = 0; i < 10; i++) {
    code = generateReferralCode();
    const { data: existing } = await client
      .from('users').select('id').eq('referral_code', code).maybeSingle();
    if (!existing) break;
  }
  await client.from('users').update({ referral_code: code }).eq('id', userId);
  return code;
}

/** Called at sign-up: links referred user to referrer via code */
export async function recordReferral(referredId: string, codeUsed: string, signupIp?: string): Promise<void> {
  const code = codeUsed?.trim().toLowerCase();
  if (!code) return;

  const client = createAdminClient();
  const { data: referrer } = await client
    .from('users').select('id, email').eq('referral_code', code).maybeSingle();
  if (!referrer || referrer.id === referredId) return; // invalid or self-referral

  // Anti-gaming: check if referrer and referred share the same email domain
  // (catches obvious alt-account self-referrals with same provider)
  const { data: referred } = await client
    .from('users').select('email').eq('id', referredId).maybeSingle();
  if (referrer.email && referred?.email) {
    const referrerDomain = referrer.email.split('@')[1]?.toLowerCase();
    const referredDomain = referred.email.split('@')[1]?.toLowerCase();
    // Only block custom domains (gmail, outlook etc. are shared by millions)
    const publicDomains = ['gmail.com', 'outlook.com', 'yahoo.com', 'hotmail.com', 'icloud.com', 'protonmail.com', 'proton.me'];
    if (referrerDomain && referrerDomain === referredDomain && !publicDomains.includes(referrerDomain)) {
      console.warn(`[referral] Blocked same-domain referral: ${referrerDomain} (referrer: ${referrer.id}, referred: ${referredId})`);
      return;
    }
  }

  // Anti-gaming: per-IP referral limit (max 3 referrals from same IP in 24h)
  if (signupIp && signupIp !== 'unknown') {
    const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { count } = await client
      .from('referrals')
      .select('*', { count: 'exact', head: true })
      .eq('signup_ip', signupIp)
      .gte('created_at', dayAgo);
    if ((count ?? 0) >= 3) {
      console.warn(`[referral] Blocked IP-spam referral: ${signupIp} (${count} in 24h)`);
      return;
    }
  }

  await client.from('users').update({ referred_by: code }).eq('id', referredId);
  await client.from('referrals').upsert(
    {
      referrer_id: referrer.id, referred_id: referredId, code_used: code, status: 'pending',
      ...(signupIp ? { signup_ip: signupIp } : {}),
    },
    { onConflict: 'referred_id', ignoreDuplicates: true }
  );
}

/** Called from Stripe webhook when a referred user pays for a plan */
export async function processReferralReward(
  referredId: string,
  plan: 'starter' | 'pro' | 'agency'
): Promise<{
  referrerId: string;
  referrerEmail: string;
  amount: number;
  newBalance: number;
  shouldNotify: boolean;
} | null> {
  const client = createAdminClient();

  const { data: referral } = await client
    .from('referrals').select('*').eq('referred_id', referredId).eq('status', 'pending').maybeSingle();
  if (!referral) return null;

  // Confirm referral with optimistic lock — prevents double-reward from concurrent requests
  const { data: confirmed, error: confirmErr } = await client.from('referrals').update({
    status: 'confirmed',
    plan_type: plan,
    confirmed_at: new Date().toISOString(),
  }).eq('id', referral.id).eq('status', 'pending').select('id').maybeSingle();

  // If no rows updated, another concurrent request already confirmed it
  if (!confirmed || confirmErr) return null;

  // Calculate reward
  let amount = 0;
  if (plan === 'pro') {
    amount = REFERRAL_REWARDS.pro;
  } else if (plan === 'agency') {
    amount = REFERRAL_REWARDS.agency;
  } else if (plan === 'starter') {
    const { count } = await client
      .from('referrals').select('*', { count: 'exact', head: true })
      .eq('referrer_id', referral.referrer_id)
      .eq('plan_type', 'starter')
      .eq('status', 'confirmed');
    if ((count ?? 0) % REFERRAL_REWARDS.starter_batch_size === 0) {
      amount = REFERRAL_REWARDS.starter_batch;
    }
  }

  if (amount > 0) {
    await client.from('referrals').update({ amount_earned: amount }).eq('id', referral.id);
  }

  const { data: referrerUser } = await client
    .from('users').select('email, referral_balance').eq('id', referral.referrer_id).single();
  if (!referrerUser || amount === 0) return null;

  const prevBalance = referrerUser.referral_balance ?? 0;
  // Atomic increment — prevents concurrent webhook calls from overwriting each other
  const { data: newBalanceRaw } = await client.rpc('increment_referral_balance', {
    p_user_id: referral.referrer_id,
    p_amount: amount,
  });
  const newBalance = (newBalanceRaw as number) ?? prevBalance + amount;

  // Notify at every 50€ increment
  const shouldNotify = Math.floor(newBalance / PAYOUT_THRESHOLD) > Math.floor(prevBalance / PAYOUT_THRESHOLD);

  if (shouldNotify) {
    const { data: existingPayout } = await client
      .from('referral_payouts').select('id').eq('referrer_id', referral.referrer_id).eq('status', 'pending').maybeSingle();
    if (existingPayout) {
      await client.from('referral_payouts').update({ amount: newBalance }).eq('id', existingPayout.id);
    } else {
      await client.from('referral_payouts').insert({ referrer_id: referral.referrer_id, amount: newBalance, status: 'pending' });
    }
  }

  return { referrerId: referral.referrer_id, referrerEmail: referrerUser.email, amount, newBalance, shouldNotify };
}

/** Called from Stripe webhook when a referred user activates their first paid site */
export async function processPerSiteReferralReward(
  referredUserId: string,
  billingType: 'monthly' | 'annual' | 'lifetime'
): Promise<{
  referrerId: string;
  referrerEmail: string;
  amount: number;
  newBalance: number;
  shouldNotify: boolean;
} | null> {
  const client = createAdminClient();

  const { data: referral } = await client
    .from('referrals').select('*').eq('referred_id', referredUserId).eq('status', 'pending').maybeSingle();
  if (!referral) return null; // no pending referral or already confirmed

  const PER_SITE_REWARDS: Record<string, number> = {
    monthly:  2,
    annual:   10,
    lifetime: 40,
  };
  const amount = PER_SITE_REWARDS[billingType] ?? 0;
  if (amount === 0) return null;

  // Mark referral as confirmed with optimistic lock
  const { data: confirmed } = await client.from('referrals').update({
    status:       'confirmed',
    plan_type:    billingType,
    confirmed_at: new Date().toISOString(),
    amount_earned: amount,
  }).eq('id', referral.id).eq('status', 'pending').select('id').maybeSingle();

  if (!confirmed) return null; // another concurrent request already confirmed

  const { data: referrerUser } = await client
    .from('users').select('email, referral_balance').eq('id', referral.referrer_id).single();
  if (!referrerUser) return null;

  const prevBalance = referrerUser.referral_balance ?? 0;
  // Atomic increment — prevents concurrent webhook calls from overwriting each other
  const { data: newBalanceRaw } = await client.rpc('increment_referral_balance', {
    p_user_id: referral.referrer_id,
    p_amount: amount,
  });
  const newBalance = (newBalanceRaw as number) ?? prevBalance + amount;

  // Notify at every 50€ increment
  const shouldNotify = Math.floor(newBalance / PAYOUT_THRESHOLD) > Math.floor(prevBalance / PAYOUT_THRESHOLD);

  if (shouldNotify) {
    const { data: existingPayout } = await client
      .from('referral_payouts').select('id').eq('referrer_id', referral.referrer_id).eq('status', 'pending').maybeSingle();
    if (existingPayout) {
      await client.from('referral_payouts').update({ amount: newBalance }).eq('id', existingPayout.id);
    } else {
      await client.from('referral_payouts').insert({ referrer_id: referral.referrer_id, amount: newBalance, status: 'pending' });
    }
  }

  return {
    referrerId:    referral.referrer_id,
    referrerEmail: referrerUser.email,
    amount,
    newBalance,
    shouldNotify,
  };
}

export async function getReferralStats(userId: string): Promise<{
  code: string;
  balance: number;
  totalEarned: number;
  pendingCount: number;
  confirmedCount: number;
  referrals: Array<{
    status: string;
    plan_type: string | null;
    amount_earned: number;
    confirmed_at: string | null;
    created_at: string;
  }>;
  payouts: Array<{ amount: number; status: string; created_at: string; paid_at: string | null }>;
  hasPendingPayout: boolean;
}> {
  const client = createAdminClient();
  const code = await ensureReferralCode(userId);

  const [{ data: user }, { data: referrals }, { data: payouts }] = await Promise.all([
    client.from('users').select('referral_balance').eq('id', userId).single(),
    client.from('referrals').select('status, plan_type, amount_earned, confirmed_at, created_at')
      .eq('referrer_id', userId).order('created_at', { ascending: false }),
    client.from('referral_payouts').select('amount, status, created_at, paid_at')
      .eq('referrer_id', userId).order('created_at', { ascending: false }),
  ]);

  const allReferrals = (referrals ?? []) as Array<{
    status: string; plan_type: string | null; amount_earned: number;
    confirmed_at: string | null; created_at: string;
  }>;
  const allPayouts = (payouts ?? []) as Array<{
    amount: number; status: string; created_at: string; paid_at: string | null;
  }>;

  return {
    code,
    balance: user?.referral_balance ?? 0,
    totalEarned: allReferrals.reduce((s, r) => s + (r.amount_earned ?? 0), 0),
    pendingCount: allReferrals.filter(r => r.status === 'pending').length,
    confirmedCount: allReferrals.filter(r => r.status === 'confirmed').length,
    referrals: allReferrals,
    payouts: allPayouts,
    hasPendingPayout: allPayouts.some(p => p.status === 'pending'),
  };
}
