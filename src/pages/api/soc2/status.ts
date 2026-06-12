// ── SOC 2 — assessment status poll ─────────────────────────────────────────
// Lightweight endpoint the report page polls while an assessment is 'running'
// (notably a deep live scan that finalizes asynchronously via the worker
// callback). Returns just the status + scores so the client can refresh itself
// the moment the run completes, instead of asking the user to reload manually.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const id = url.searchParams.get('id');
  if (!id) return json({ error: 'Missing id.' }, 400);

  const client = createAdminClient();
  const { data, error } = await client
    .from('soc2_assessments')
    .select('status, overall_score')
    .eq('id', id)
    .eq('user_id', user.id) // ownership scope
    .single();

  if (error || !data) return json({ error: 'Not found.' }, 404);
  return json({ status: data.status, overall: data.overall_score ?? null });
};
