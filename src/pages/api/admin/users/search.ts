// GET /api/admin/users/search?q=...
// Searches users by email (ilike) or name; returns up to 15 results with plan + quick stats.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase';
import { verifyAdminSession } from '../../../../lib/admin-auth';
import { json } from '../../../../lib/api-utils';

export const GET: APIRoute = async ({ cookies, url }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);

  const q = (url.searchParams.get('q') ?? '').trim();
  if (q.length < 2) return json({ users: [] });

  const client = createAdminClient();
  const { data, error } = await client
    .from('users')
    .select('id, email, name, plan, referral_balance, created_at')
    .or(`email.ilike.%${q}%,name.ilike.%${q}%`)
    .order('created_at', { ascending: false })
    .limit(15);

  if (error) return json({ error: error.message }, 500);
  return json({ users: data ?? [] });
};
