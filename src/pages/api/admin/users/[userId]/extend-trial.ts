// POST /api/admin/users/[userId]/extend-trial { days: number, projectId?: string }
// Pushes expires_at on all of the user's free/expired projects (or a specific one).
// Flips billing_status from 'expired' back to 'free' so the site becomes reachable
// again until the next cron pass (we DON'T redeploy the real HTML here — user needs
// to pay to restore the live site. This is a goodwill extension for free trials only).

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
  const days = Math.round(Number(body?.days ?? 0));
  const specificProjectId = body?.projectId as string | undefined;
  if (!Number.isFinite(days) || days < 1 || days > 365) return json({ error: 'days must be 1..365' }, 400);

  const client = createAdminClient();
  const newExpiry = new Date(Date.now() + days * 86_400_000).toISOString();

  let query = client
    .from('projects')
    .update({ expires_at: newExpiry, billing_status: 'free', updated_at: new Date().toISOString() })
    .eq('user_id', userId)
    .in('billing_status', ['free', 'expired']);
  if (specificProjectId) query = query.eq('id', specificProjectId);

  const { data, error } = await query.select('id, name, billing_status, expires_at');
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, updated: data?.length ?? 0, newExpiry, projects: data ?? [] });
};
