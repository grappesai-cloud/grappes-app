// ── SOC 2 Live Pentest — check domain verification ─────────────────────────
// Runs the DNS/file check for a pending verification the user owns. On success
// flips status to 'verified' and stamps verified_at — the gate that unlocks
// live scanning for this domain.

import type { APIRoute } from 'astro';
import { runCheck, type VerifyMethod } from '../../../../lib/soc2/verify-domain';
import { createAdminClient } from '../../../../lib/supabase';
import { checkPersistentRateLimit, recordPersistentRateLimit } from '../../../../lib/rate-limit';
import { json } from '../../../../lib/api-utils';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const rlKey = `soc2-verify-check:${user.id}`;
  if (!(await checkPersistentRateLimit(rlKey, 15, 60_000))) {
    return json({ error: 'Too many checks — wait a moment for DNS to propagate.' }, 429);
  }
  await recordPersistentRateLimit(rlKey);

  let id: string | undefined;
  try {
    const body = (await request.json()) as { id?: string };
    id = body.id;
  } catch {
    return json({ error: 'Bad JSON body.' }, 400);
  }
  if (!id) return json({ error: 'Missing verification id.' }, 400);

  const client = createAdminClient();
  const { data: rec } = await client
    .from('soc2_domain_verifications')
    .select('id, domain, method, token, status')
    .eq('id', id)
    .eq('user_id', user.id)   // ownership scope — can't check someone else's record
    .single();
  if (!rec) return json({ error: 'Verification not found.' }, 404);

  if (rec.status === 'verified') {
    return json({ status: 'verified', detail: 'Already verified.' });
  }

  const result = await runCheck(rec.method as VerifyMethod, rec.domain, rec.token);

  const nowIso = new Date().toISOString();
  if (result.ok) {
    await client
      .from('soc2_domain_verifications')
      .update({ status: 'verified', verified_at: nowIso, last_checked_at: nowIso })
      .eq('id', rec.id);
    return json({ status: 'verified', detail: result.detail });
  }

  await client
    .from('soc2_domain_verifications')
    .update({ last_checked_at: nowIso })
    .eq('id', rec.id);
  return json({ status: 'pending', detail: result.detail });
};
