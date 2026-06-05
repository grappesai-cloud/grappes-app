// ── SOC 2 Live Pentest — start domain verification ─────────────────────────
// Normalizes the domain, mints a token, and upserts a pending verification.
// Idempotent per (user, domain): re-starting returns the existing token unless
// it was already verified (then we keep it verified).

import type { APIRoute } from 'astro';
import { normalizeDomain, generateToken, dnsRecordValue, wellKnownPath, type VerifyMethod } from '../../../../lib/soc2/verify-domain';
import { createAdminClient } from '../../../../lib/supabase';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { json } from '../../../../lib/api-utils';

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!checkRateLimit(`soc2-verify-start:${user.id}`, 10, 60_000)) {
    return json({ error: 'Slow down — try again in a moment.' }, 429);
  }

  let rawDomain: string | undefined;
  let method: VerifyMethod = 'dns_txt';
  try {
    const body = (await request.json()) as { domain?: string; method?: VerifyMethod };
    rawDomain = body.domain;
    if (body.method === 'file' || body.method === 'dns_txt') method = body.method;
  } catch {
    return json({ error: 'Bad JSON body.' }, 400);
  }

  const domain = normalizeDomain(rawDomain ?? '');
  if (!domain) return json({ error: 'Enter a valid public domain (e.g. example.com).' }, 400);

  const client = createAdminClient();

  // Existing record?
  const { data: existing } = await client
    .from('soc2_domain_verifications')
    .select('id, token, method, status')
    .eq('user_id', user.id)
    .eq('domain', domain)
    .single();

  let record = existing;
  if (existing) {
    // If the method changed (and not yet verified), refresh method + token.
    if (existing.status !== 'verified' && existing.method !== method) {
      const token = generateToken();
      const { data: upd } = await client
        .from('soc2_domain_verifications')
        .update({ method, token, status: 'pending' })
        .eq('id', existing.id)
        .select('id, token, method, status')
        .single();
      record = upd ?? existing;
    }
  } else {
    const token = generateToken();
    const { data: ins, error } = await client
      .from('soc2_domain_verifications')
      .insert({ user_id: user.id, domain, method, token, status: 'pending' })
      .select('id, token, method, status')
      .single();
    if (error || !ins) {
      console.error('[soc2/verify/start] insert error:', error);
      return json({ error: 'Could not start verification.' }, 500);
    }
    record = ins;
  }

  return json({
    id: record!.id,
    domain,
    method: record!.method,
    status: record!.status,
    token: record!.token,
    instructions: record!.method === 'dns_txt'
      ? { type: 'dns_txt', name: '@ (or the domain root)', recordType: 'TXT', value: dnsRecordValue(record!.token) }
      : { type: 'file', url: `https://${domain}${wellKnownPath(record!.token)}`, content: record!.token },
  });
};
