import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 10 code changes/hour per user
  if (!checkRateLimit(`update-code:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'Too many requests. Please wait before changing your code again.' }, 429);
  }

  const { code } = await request.json().catch(() => ({}));
  const cleaned = code?.trim().toLowerCase();

  if (!cleaned || !/^[a-z0-9]{3,20}$/.test(cleaned)) {
    return json({ error: 'Cod invalid. Doar litere și cifre, 3-20 caractere.' }, 400);
  }

  const client = createAdminClient();

  // Check availability (exclude current user)
  const { data: existing } = await client
    .from('users').select('id').eq('referral_code', cleaned).maybeSingle();
  if (existing && existing.id !== user.id) {
    return json({ error: 'Codul este deja folosit. Alege altul.' }, 409);
  }

  await client.from('users').update({ referral_code: cleaned }).eq('id', user.id);
  return json({ ok: true, code: cleaned });
};
