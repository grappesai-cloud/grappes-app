// ── Savoy admin: mark a scheduled post as posted / canceled ──────────────────

import type { APIRoute } from 'astro';
import { getPg } from '../../../../lib/supabase';
import { json } from '../../../../lib/api-utils';

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const status = body?.status;
  if (status !== 'posted' && status !== 'canceled') return json({ error: 'Status invalid.' }, 400);

  const sql = getPg();
  const rows = await sql`
    UPDATE savoy_posts
    SET status = ${status}, posted_at = CASE WHEN ${status} = 'posted' THEN now() ELSE posted_at END
    WHERE id = ${params.id} AND user_id = ${user.id} AND status = 'queued'
    RETURNING id
  `;
  if (!rows[0]) return json({ error: 'Postare inexistentă sau deja procesată.' }, 404);
  return json({ ok: true });
};
