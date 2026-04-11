import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


export const GET: APIRoute = async ({ url, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 20 checks/min per IP — prevents referral code enumeration
  if (!checkRateLimit(`check-code:ip:${getClientIp(request)}`, 20, 60_000)) {
    return json({ error: 'Too many requests' }, 429);
  }

  const code = url.searchParams.get('code')?.trim().toLowerCase();
  if (!code) return json({ available: false, error: 'Cod lipsă' });
  if (!/^[a-z0-9]{3,20}$/.test(code)) return json({ available: false, error: 'Doar litere și cifre, 3-20 caractere' });

  const client = createAdminClient();
  const { data } = await client
    .from('users').select('id').eq('referral_code', code).maybeSingle();

  // Available if no one has it, or only the current user has it
  const available = !data || data.id === user.id;
  return json({ available, code });
};
