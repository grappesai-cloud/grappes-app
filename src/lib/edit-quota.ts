// ── Edit quota (legacy user-level, retained for /dashboard/account display) ─
// AI editor iterations are now per-project (see consume_project_iteration).
// This file only exposes a read-only quota lookup for the account page and
// the EXTRA_PACK_EDITS constant referenced by the Stripe webhook.

import { createAdminClient } from './supabase';

export const EDIT_LIMITS: Record<string, number> = {
  free:    0,
  starter: 3,
  pro:     10,
  agency:  25,
  owner:   999999,
};

export const EXTRA_PACK_EDITS = 10;

export interface EditQuotaResult {
  allowed:   boolean;
  used:      number;
  limit:     number;
  extra:     number;
  remaining: number;
  plan:      string;
}

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
