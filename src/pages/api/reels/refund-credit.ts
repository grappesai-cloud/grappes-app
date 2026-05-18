// ── Refund a reel credit — called by reel-lab when an analysis fails ───────

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const client = createAdminClient();
  const { data: newBalance, error } = await client.rpc('refund_reel_credit', {
    p_user_id: user.id,
  });

  if (error) {
    console.error('[reels/refund-credit] RPC error:', error);
    return json({ error: 'Refund service error' }, 500);
  }

  return json({ remaining: newBalance });
};
