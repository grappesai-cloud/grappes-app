// ── Atomic credit consume — called by reel-lab before starting an analysis ──
// Returns the new balance, or 402 if the user is out of credits.
//
// Auth: this endpoint runs in the grappes-app server, so it relies on the
// same Supabase SSR cookie. reel-lab forwards the cookie when calling.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const client = createAdminClient();
  const { data: newBalance, error } = await client.rpc('consume_reel_credit_atomic', {
    p_user_id: user.id,
  });

  if (error) {
    console.error('[reels/consume-credit] RPC error:', error);
    return json({ error: 'Credit service error' }, 500);
  }

  // RPC returns NULL when WHERE clause matched 0 rows (no credits / no user)
  if (newBalance === null) {
    return json({ error: 'No reel credits remaining', remaining: 0 }, 402);
  }

  return json({ remaining: newBalance });
};
