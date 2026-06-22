// GET  /api/admin/users/[userId] — full admin view of one user
// Returns: user row, projects, recent support thread

import type { APIRoute } from 'astro';
import { createAdminClient, getPg } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { json } from '../../../../../lib/api-utils';

export const GET: APIRoute = async ({ cookies, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  const client = createAdminClient();
  const [
    { data: user },
    { data: projects },
    { data: openThread },
  ] = await Promise.all([
    client.from('users')
      .select('id, email, name, plan, projects_limit, extra_edits, edits_used, edits_period_start, multipage_addon, multipage_addon_lifetime, reel_credits, audit_credits, soc2_credits, logo_credits, offer_credits, brandbook_credits, social_credits, site_credits, allowed_tools, marketing_opt_out, email_bounced_at, created_at')
      .eq('id', userId).maybeSingle(),
    client.from('projects')
      .select('id, name, status, billing_status, billing_type, expires_at, preview_url, created_at, updated_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    client.from('support_threads')
      .select('id, status, last_message_at')
      .eq('user_id', userId)
      .eq('status', 'open')
      .maybeSingle(),
  ]);

  if (!user) return json({ error: 'User not found' }, 404);

  // Last activity = newest session touch (login / refresh).
  let lastActive: string | null = null;
  try {
    const rows = await getPg()`
      SELECT MAX(GREATEST(created_at, updated_at)) AS la FROM "session" WHERE user_id = ${userId}
    ` as Array<{ la: string | null }>;
    lastActive = rows?.[0]?.la ?? null;
  } catch { /* session table unavailable — leave null */ }

  return json({
    user,
    projects: projects ?? [],
    openThread: openThread || null,
    lastActive,
  });
};

// DELETE /api/admin/users/[userId] — remove an account entirely.
// Deletes the public.users profile first (so its FK to "user" can't block),
// then the Better-Auth "user" row, which cascades sessions + accounts. If the
// profile still has content protected by a RESTRICT foreign key, the delete
// errors cleanly and nothing is removed.
export const DELETE: APIRoute = async ({ cookies, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  const sql = getPg();
  try {
    await sql`DELETE FROM public.users WHERE id = ${userId}`;
    const deleted = await sql`DELETE FROM "user" WHERE id = ${userId} RETURNING id`;
    if (deleted.length === 0) return json({ error: 'User not found' }, 404);
    return json({ ok: true, deleted: userId });
  } catch (err) {
    console.error('[admin/users/delete] failed:', err);
    const msg = err instanceof Error ? err.message : 'delete failed';
    if (/foreign key|violates/i.test(msg)) {
      return json({ error: 'This account still has content (sites, logos, etc.). Remove it first.' }, 409);
    }
    return json({ error: msg }, 500);
  }
};
