// ── SOC 2 monitors — create / list / disable ───────────────────────────────
// A monitor tells the soc2-monitor cron to keep re-scanning a repo on a cadence.

import type { APIRoute } from 'astro';
import { getPg } from '../../../lib/supabase';
import { parseGitHubUrl } from '../../../lib/soc2/fetch-repo';
import { json } from '../../../lib/api-utils';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in.' }, 401);
  const sql = getPg();
  const monitors = await sql`SELECT id, target, cadence, active, last_run_at, last_overall, last_findings
    FROM soc2_monitors WHERE user_id = ${user.id} ORDER BY created_at DESC`;
  return json({ monitors });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in.' }, 401);
  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON.' }, 400); }
  const target = String(body?.target ?? '').trim();
  if (!parseGitHubUrl(target)) return json({ error: 'Provide a GitHub repo URL.' }, 400);
  const cadence = body?.cadence === 'daily' ? 'daily' : 'weekly';

  const sql = getPg();
  const count = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM soc2_monitors WHERE user_id = ${user.id} AND active = true`;
  if ((count[0]?.n ?? 0) >= 25) return json({ error: 'Monitor limit reached.' }, 403);

  await sql`INSERT INTO soc2_monitors (user_id, target, cadence)
    VALUES (${user.id}, ${target}, ${cadence})
    ON CONFLICT (user_id, target) DO UPDATE SET cadence = ${cadence}, active = true, updated_at = now()`;
  return json({ ok: true, target, cadence });
};

export const DELETE: APIRoute = async ({ locals, request, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in.' }, 401);
  let target = url.searchParams.get('target') ?? '';
  if (!target) { try { target = String((await request.json())?.target ?? ''); } catch { /* */ } }
  if (!target) return json({ error: 'target required.' }, 400);
  const sql = getPg();
  await sql`UPDATE soc2_monitors SET active = false, updated_at = now() WHERE user_id = ${user.id} AND target = ${target}`;
  return json({ ok: true });
};
