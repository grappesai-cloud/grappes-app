// ── Edit quota enforcement ────────────────────────────────────────────────────
// Plans and monthly edit limits:
//   free    (gratuit)       → 0 edits/month
//   pro     (€99/an)        → 10 edits/month
//   agency  (€399 lifetime) → 25 edits/month
//
// Extra packs: +10 edits for €5 (non-expiring, consumed after monthly quota)
//
// checkAndConsumeEdit uses a Postgres RPC (consume_edit) that wraps the
// check-and-update in a single row-locked transaction, eliminating the
// race condition where two concurrent requests could both pass the quota check.
// See: supabase/migrations/003_consume_edit_atomic.sql

import { createAdminClient } from './supabase';

export const EDIT_LIMITS: Record<string, number> = {
  free:    0,
  starter: 3,
  pro:     10,
  agency:  25,
  owner:   999999, // unlimited
};

export const EXTRA_PACK_EDITS = 10;
export const EXTRA_PACK_PRICE_EUR = 5;

export interface EditQuotaResult {
  allowed:   boolean;
  used:      number;   // edits used this period (after this call if allowed)
  limit:     number;   // monthly limit for the plan
  extra:     number;   // remaining purchased extra edits
  remaining: number;   // total remaining (limit + extra - used)
  plan:      string;
}

/**
 * Atomically checks the user's edit quota and, if allowed, consumes one edit.
 * Delegates to the consume_edit Postgres function which uses FOR UPDATE to
 * prevent race conditions under concurrent requests.
 */
export async function checkAndConsumeEdit(userId: string): Promise<EditQuotaResult> {
  const client = createAdminClient();

  const { data, error } = await client.rpc('consume_edit', { p_user_id: userId });

  if (error || !data) {
    console.error('[edit-quota] consume_edit RPC error:', error);
    return { allowed: false, used: 0, limit: 0, extra: 0, remaining: 0, plan: 'free' };
  }

  const r = data as EditQuotaResult & { error?: string };
  if (r.error === 'user_not_found') {
    return { allowed: false, used: 0, limit: 0, extra: 0, remaining: 0, plan: 'free' };
  }

  return {
    allowed:   r.allowed,
    used:      r.used   ?? 0,
    limit:     r.limit  ?? 0,
    extra:     r.extra  ?? 0,
    remaining: r.remaining ?? 0,
    plan:      r.plan   ?? 'free',
  };
}

/**
 * Returns quota info without consuming an edit (for UI display).
 */
export async function getEditQuota(userId: string): Promise<EditQuotaResult> {
  const client = createAdminClient();

  const { data: user, error } = await client
    .from('users')
    .select('plan, edits_used, edits_period_start, extra_edits')
    .eq('id', userId)
    .single();

  if (error || !user) {
    return { allowed: false, used: 0, limit: 0, extra: 0, remaining: 0, plan: 'free' };
  }

  const monthlyLimit = EDIT_LIMITS[user.plan] ?? 0;
  const now = new Date();
  const periodStart = new Date(user.edits_period_start);
  const isSameMonth = (a: Date, b: Date) =>
    a.getUTCFullYear() === b.getUTCFullYear() && a.getUTCMonth() === b.getUTCMonth();

  let editsUsed = user.edits_used ?? 0;
  if (!isSameMonth(now, periodStart)) editsUsed = 0;

  const extraEdits = user.extra_edits ?? 0;
  const totalAllowed = monthlyLimit + extraEdits;
  const remaining = Math.max(0, totalAllowed - editsUsed);

  return {
    allowed:   remaining > 0,
    used:      editsUsed,
    limit:     monthlyLimit,
    extra:     extraEdits,
    remaining,
    plan:      user.plan,
  };
}
