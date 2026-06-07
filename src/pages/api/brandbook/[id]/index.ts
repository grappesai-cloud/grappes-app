// ── DELETE /api/brandbook/[id] — remove a brand book ─────────────────────────

import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api-utils';
import { createAdminClient } from '../../../../lib/supabase';

export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const client = createAdminClient();
  const { error } = await client
    .from('press_kits')
    .delete()
    .eq('id', params.id as string)
    .eq('user_id', user.id)
    .eq('mode', 'brand_book');

  if (error) {
    console.error('[brandbook/delete] failed:', error);
    return json({ error: 'Could not delete.' }, 500);
  }
  return json({ ok: true });
};
