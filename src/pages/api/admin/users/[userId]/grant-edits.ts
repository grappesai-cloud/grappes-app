// POST /api/admin/users/[userId]/grant-edits { amount: number }
// Adds `amount` to users.extra_edits.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { json } from '../../../../../lib/api-utils';

export const POST: APIRoute = async ({ cookies, request, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const amount = Number(body?.amount ?? 0);
  if (!Number.isFinite(amount) || amount === 0 || amount < -999_999 || amount > 999_999) {
    return json({ error: 'amount must be a non-zero number' }, 400);
  }

  const client = createAdminClient();
  const { data: current } = await client.from('users').select('extra_edits').eq('id', userId).maybeSingle();
  if (!current) return json({ error: 'User not found' }, 404);
  const nextValue = Math.max(0, (current.extra_edits ?? 0) + amount);

  const { error } = await client.from('users').update({ extra_edits: nextValue }).eq('id', userId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, extra_edits: nextValue });
};
