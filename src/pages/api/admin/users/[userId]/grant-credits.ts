// POST /api/admin/users/[userId]/grant-credits { kind, amount }
// Generic credit grant/deduct for ANY tool (white-label model: credits are
// provisioned here by the admin, not bought). `amount` may be negative to
// deduct; the balance is clamped at 0. Backs the universal credit system
// (migration 0029). kind is whitelisted via CREDIT_COLUMN.
import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { CREDIT_COLUMN, type CreditKind } from '../../../../../lib/credits';
import { json } from '../../../../../lib/api-utils';

export const POST: APIRoute = async ({ cookies, request, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const kind = body?.kind as CreditKind;
  if (!kind || !(kind in CREDIT_COLUMN)) {
    return json({ error: `kind must be one of: ${Object.keys(CREDIT_COLUMN).join(', ')}` }, 400);
  }
  const amount = Number(body?.amount ?? 0);
  if (!Number.isFinite(amount) || amount === 0 || amount < -999_999 || amount > 999_999) {
    return json({ error: 'amount must be a non-zero number' }, 400);
  }

  const col = CREDIT_COLUMN[kind];
  const client = createAdminClient();
  const { data: current } = await client.from('users').select(col).eq('id', userId).maybeSingle();
  if (!current) return json({ error: 'User not found' }, 404);

  const target = Math.max(0, Number((current as any)[col] ?? 0) + amount);
  const { error } = await client.from('users').update({ [col]: target }).eq('id', userId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, kind, balance: target });
};
