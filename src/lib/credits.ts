// Universal per-tool credit helpers (white-label: admin-granted, no Stripe
// self-serve). Backed by the generic SQL RPCs in migration 0029
// (consume_credit / grant_credit / refund_credit, keyed by a whitelisted kind).
import { createAdminClient } from './supabase';

export type CreditKind =
  | 'reel' | 'audit' | 'soc2' | 'logo' | 'offer' | 'brandbook' | 'social' | 'site';

export const CREDIT_COLUMN: Record<CreditKind, string> = {
  reel: 'reel_credits',
  audit: 'audit_credits',
  soc2: 'soc2_credits',
  logo: 'logo_credits',
  offer: 'offer_credits',
  brandbook: 'brandbook_credits',
  social: 'social_credits',
  site: 'site_credits',
};

/**
 * Atomically consume `amount` credits of `kind`. Returns the new balance, or
 * NULL when the user has insufficient credits (callers should 402 on null).
 */
export async function consumeCredit(userId: string, kind: CreditKind, amount = 1): Promise<number | null> {
  const { data, error } = await createAdminClient().rpc('consume_credit', {
    p_user_id: userId, p_kind: kind, p_amount: amount,
  });
  if (error) throw error;
  return data === null || data === undefined ? null : Number(data);
}

/** Refund credits after a downstream failure. Best-effort; never throws. */
export async function refundCredit(userId: string, kind: CreditKind, amount = 1): Promise<void> {
  try {
    await createAdminClient().rpc('refund_credit', { p_user_id: userId, p_kind: kind, p_amount: amount });
  } catch (e) {
    console.warn('[credits] refund failed (non-fatal):', e);
  }
}

/** Grant credits (admin). Returns the new balance. */
export async function grantCredit(userId: string, kind: CreditKind, amount: number): Promise<number> {
  const { data, error } = await createAdminClient().rpc('grant_credit', {
    p_user_id: userId, p_kind: kind, p_amount: amount,
  });
  if (error) throw error;
  return Number(data);
}

/** Read all credit balances for a user. */
export async function getCredits(userId: string): Promise<Record<CreditKind, number>> {
  const cols = Object.values(CREDIT_COLUMN).join(',');
  const { data, error } = await createAdminClient().from('users').select(cols).eq('id', userId).single();
  if (error) throw error;
  const row = (data ?? {}) as Record<string, number>;
  const out = {} as Record<CreditKind, number>;
  for (const [kind, col] of Object.entries(CREDIT_COLUMN)) out[kind as CreditKind] = Number(row[col] ?? 0);
  return out;
}
