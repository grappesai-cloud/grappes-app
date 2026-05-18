// ── Index a reel analysis for the Studio activity feed ─────────────────────
// Called by reel-lab after creating a Neon row, with the new analysis_id
// and a short title. status updates ('running' → 'complete' | 'failed')
// also flow through this endpoint via PATCH-style POST with an existing id.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

type Status = 'pending' | 'running' | 'complete' | 'failed';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let body: { analysis_id?: string; title?: string; status?: Status } = {};
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Bad JSON' }, 400);
  }

  const { analysis_id, title, status } = body;
  if (!analysis_id) return json({ error: 'analysis_id required' }, 400);

  const client = createAdminClient();

  // Upsert by (user_id, analysis_id). Updates status/title on subsequent calls.
  const { error } = await client
    .from('reel_analyses_index')
    .upsert(
      {
        user_id: user.id,
        analysis_id,
        ...(title !== undefined && { title }),
        ...(status !== undefined && { status }),
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id,analysis_id' }
    );

  if (error) {
    console.error('[reels/log-analysis] Supabase error:', error);
    return json({ error: 'Index write failed' }, 500);
  }

  return json({ ok: true });
};
