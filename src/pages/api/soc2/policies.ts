// ── SOC 2 policy pack generation endpoint ──────────────────────────────────
// Generates the tailored policy/process pack (policies + risk register + System
// Description). Heavy multi-call generation, so it's auth-gated, rate-limited,
// and costs 1 SOC 2 credit (consumed only on success).

import type { APIRoute } from 'astro';
import { generatePolicyPack } from '../../../lib/soc2/policies';
import { createAdminClient } from '../../../lib/supabase';
import { checkPersistentRateLimit, recordPersistentRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

export const maxDuration = 300;

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to generate policies.' }, 401);

  const rlKey = `soc2-policies:${user.id}`;
  if (!(await checkPersistentRateLimit(rlKey, 3, 3_600_000))) {
    return json({ error: 'Slow down — a few policy packs per hour.' }, 429);
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Bad JSON body.' }, 400); }
  const company = String(body?.company ?? '').trim();
  if (!company) return json({ error: 'company is required.' }, 400);
  const stack = body?.stack ? String(body.stack).slice(0, 600) : undefined;
  const findingsSummary = body?.findingsSummary ? String(body.findingsSummary).slice(0, 4000) : undefined;
  const only = Array.isArray(body?.only) ? body.only.map(String).slice(0, 20) : undefined;

  const client = createAdminClient();

  // Gate on available credit (read) before doing the heavy work; consume after.
  const { data: row } = await client.from('users').select('soc2_credits').eq('id', user.id).maybeSingle();
  const balance = Number((row as any)?.soc2_credits ?? 0);
  const isOwner = false; // policy gen always costs a credit unless you wire owner-bypass
  if (!isOwner && balance < 1) return json({ error: 'No SOC 2 credits remaining.', remaining: 0 }, 402);

  let pack;
  try {
    pack = await generatePolicyPack({ company, stack, findingsSummary }, only ? { only } : {});
  } catch (e: any) {
    return json({ error: `Policy generation failed: ${e?.message ?? 'unknown'}` }, 500);
  }

  // Consume the credit only now that we have a result.
  await client.rpc('consume_soc2_credits_atomic', { p_user_id: user.id, p_amount: 1 }).catch(() => {});
  await recordPersistentRateLimit(rlKey);

  return json({ pack });
};
