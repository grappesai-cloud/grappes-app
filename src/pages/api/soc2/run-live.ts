// ── SOC 2 Live Pentest — run endpoint ──────────────────────────────────────
// Gated hard: the domain must be VERIFIED and owned by this user, and the user
// must sign explicit authorization at run time (stored as the legal record).
// Then: consume credits → insert assessment (mode=live) → run recon → update.

import type { APIRoute } from 'astro';
import { runLiveScan } from '../../../lib/soc2/live-scan';
import { isVerificationExpired, VERIFICATION_TTL_DAYS } from '../../../lib/soc2/verify-domain';
import { createAdminClient } from '../../../lib/supabase';
import { checkPersistentRateLimit, recordPersistentRateLimit, getClientIp } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const LIVE_CREDIT_COST = 3; // recon-only live scan
const DEEP_CREDIT_COST = 8; // recon + offensive worker scan
const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

// Dispatch the offensive job to the standalone worker. Returns true if accepted.
async function dispatchDeep(domain: string, assessmentId: string): Promise<boolean> {
  const workerUrl = import.meta.env.SOC2_WORKER_URL;
  const workerSecret = import.meta.env.SOC2_WORKER_SECRET;
  if (!workerUrl || !workerSecret) return false;
  try {
    const res = await fetch(`${workerUrl.replace(/\/$/, '')}/scan`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${workerSecret}` },
      body: JSON.stringify({ domain, assessmentId, callbackUrl: `${SITE_URL}/api/soc2/scan-callback` }),
    });
    return res.status === 202;
  } catch {
    return false;
  }
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to run a scan.' }, 401);

  const rlKey = `soc2-live:${user.id}`;
  if (!(await checkPersistentRateLimit(rlKey, 3, 60_000))) {
    return json({ error: 'Slow down — only a few scans per minute.' }, 429);
  }
  await recordPersistentRateLimit(rlKey);

  let verificationId: string | undefined;
  let consent = false;
  let deep = false;
  try {
    const body = (await request.json()) as { verificationId?: string; consent?: boolean; deep?: boolean };
    verificationId = body.verificationId;
    consent = body.consent === true;
    deep = body.deep === true;
  } catch {
    return json({ error: 'Bad JSON body.' }, 400);
  }
  if (!verificationId) return json({ error: 'Missing verification id.' }, 400);
  if (!consent) return json({ error: 'Authorization is required to run an active scan.' }, 403);

  // Deep scan only applies if the worker is configured; otherwise fall back to recon.
  const workerAvailable = !!import.meta.env.SOC2_WORKER_URL && !!import.meta.env.SOC2_WORKER_SECRET;
  const runDeep = deep && workerAvailable;
  const creditCost = runDeep ? DEEP_CREDIT_COST : LIVE_CREDIT_COST;

  const client = createAdminClient();

  // ── Gate: domain must be verified AND owned by this user ────────────
  const { data: ver } = await client
    .from('soc2_domain_verifications')
    .select('id, domain, status, verified_at')
    .eq('id', verificationId)
    .eq('user_id', user.id)
    .single();
  if (!ver) return json({ error: 'Domain verification not found.' }, 404);
  if (ver.status !== 'verified') {
    return json({ error: 'This domain is not verified. Verify ownership before scanning.' }, 403);
  }
  // Authorization expires — a domain can change ownership after it was verified.
  if (isVerificationExpired(ver.verified_at)) {
    // Mark it expired so the hub stops offering it until the user re-verifies.
    await client.from('soc2_domain_verifications').update({ status: 'pending', verified_at: null }).eq('id', ver.id);
    return json({ error: `Domain verification expired (re-verify required every ${VERIFICATION_TTL_DAYS} days). Re-verify ownership before scanning.` }, 403);
  }

  const consentIp = getClientIp(request);
  const consentAt = new Date().toISOString();

  // ── Consume credits atomically (deep costs more) ───────────────────
  const { data: newBalance, error: consumeError } = await client.rpc(
    'consume_soc2_credits_atomic', { p_user_id: user.id, p_amount: creditCost },
  );
  if (consumeError) {
    console.error('[soc2/run-live] consume RPC error:', consumeError);
    return json({ error: 'Credit service unavailable.' }, 503);
  }
  if (newBalance === null) {
    return json({ error: `Not enough credits. This scan costs ${creditCost}.`, remaining: 0 }, 402);
  }

  // ── Insert running assessment with the authorization record ────────
  const { data: inserted, error: insertError } = await client
    .from('soc2_assessments')
    .insert({
      user_id: user.id,
      mode: 'live',
      target: ver.domain,
      verification_id: ver.id,
      consent_signed_at: consentAt,
      consent_ip: consentIp,
      credits_spent: creditCost,
      status: 'running',
    })
    .select('id')
    .single();
  if (insertError || !inserted) {
    console.error('[soc2/run-live] insert error:', insertError);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: creditCost });
    return json({ error: 'Could not start scan.' }, 500);
  }
  const assessmentId = inserted.id as string;

  // ── Run the recon scan (always) ────────────────────────────────────
  let report;
  try {
    report = await runLiveScan(ver.domain);
  } catch (e) {
    console.error('[soc2/run-live] recon failed:', e);
    const message = e instanceof Error ? e.message : String(e);
    await client.from('soc2_assessments').update({ status: 'failed' }).eq('id', assessmentId);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: creditCost });
    return json({ error: 'Scan failed: ' + message }, 500);
  }

  const scoreRow = {
    overall_score: report.scores.overall,
    security_score: report.scores.security,
    availability_score: report.scores.availability,
    confidentiality_score: report.scores.confidentiality,
    integrity_score: report.scores.integrity,
    privacy_score: report.scores.privacy,
    report,
  };

  // ── Deep scan: keep 'running', dispatch offensive job; worker callback finalizes ──
  if (runDeep) {
    await client.from('soc2_assessments').update(scoreRow).eq('id', assessmentId); // save recon as partial
    const accepted = await dispatchDeep(ver.domain, assessmentId);
    if (accepted) {
      return json({ id: assessmentId, remaining: newBalance, deep: true, status: 'running' });
    }
    // Worker unreachable — finalize with recon and refund the deep surcharge.
    await client.from('soc2_assessments')
      .update({ ...scoreRow, status: 'complete', credits_spent: LIVE_CREDIT_COST })
      .eq('id', assessmentId);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: DEEP_CREDIT_COST - LIVE_CREDIT_COST });
    return json({ id: assessmentId, remaining: newBalance + (DEEP_CREDIT_COST - LIVE_CREDIT_COST), deep: false, scores: report.scores });
  }

  // ── Recon-only: complete now ───────────────────────────────────────
  await client.from('soc2_assessments').update({ ...scoreRow, status: 'complete' }).eq('id', assessmentId);
  return json({ id: assessmentId, remaining: newBalance, scores: report.scores });
};
