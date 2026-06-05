// ── SOC 2 Live Pentest — worker callback ───────────────────────────────────
// The offensive worker posts results here when a deep scan finishes. We verify
// the HMAC signature, merge the offensive findings into the recon report already
// stored on the assessment, re-score, and mark it complete. On worker failure we
// refund the credits that the deep scan cost.

import type { APIRoute } from 'astro';
import crypto from 'node:crypto';
import { createAdminClient } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

const SEVERITY_WEIGHT: Record<string, number> = {
  critical: 25, high: 15, medium: 8, low: 3, info: 0,
};
const CRITERIA = ['security', 'availability', 'confidentiality', 'integrity', 'privacy'] as const;

function deriveScore(findings: any[], criterion: string): number {
  const penalty = findings
    .filter(f => f.criterion === criterion)
    .reduce((s, f) => s + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.SOC2_WORKER_CALLBACK_SECRET;
  if (!secret) return json({ error: 'Worker callback not configured.' }, 503);

  // Verify the HMAC signature over the raw body before trusting anything.
  const raw = await request.text();
  const provided = request.headers.get('x-soc2-signature') ?? '';
  const expected = crypto.createHmac('sha256', secret).update(raw).digest('hex');
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return json({ error: 'Invalid signature.' }, 401);
  }

  let envelope: any;
  try { envelope = JSON.parse(raw); } catch { return json({ error: 'Bad JSON.' }, 400); }

  const assessmentId = envelope.assessmentId as string | undefined;
  if (!assessmentId) return json({ error: 'Missing assessmentId.' }, 400);

  const client = createAdminClient();
  const { data: assessment } = await client
    .from('soc2_assessments')
    .select('id, user_id, report, credits_spent, status')
    .eq('id', assessmentId)
    .single();
  if (!assessment) return json({ error: 'Assessment not found.' }, 404);

  // Idempotency: ignore a second callback for an already-finalized assessment.
  if (assessment.status !== 'running') return json({ ok: true, note: 'already finalized' });

  // Worker reported failure → refund the deep-scan credits, mark failed.
  if (!envelope.ok) {
    await client.from('soc2_assessments').update({ status: 'failed' }).eq('id', assessmentId);
    if (assessment.credits_spent) {
      await client.rpc('refund_soc2_credits', { p_user_id: assessment.user_id, p_amount: assessment.credits_spent });
    }
    return json({ ok: true, note: 'marked failed + refunded' });
  }

  const result = envelope.result ?? {};
  const offensive: any[] = Array.isArray(result.findings) ? result.findings : [];
  const base = assessment.report ?? {};
  const merged = [...(base.findings ?? []), ...offensive];

  const scores = {
    security: deriveScore(merged, 'security'),
    availability: deriveScore(merged, 'availability'),
    confidentiality: deriveScore(merged, 'confidentiality'),
    integrity: deriveScore(merged, 'integrity'),
    privacy: deriveScore(merged, 'privacy'),
  };
  const overall = Math.round(
    scores.security * 0.4 + scores.confidentiality * 0.2 + scores.integrity * 0.15 +
    scores.availability * 0.15 + scores.privacy * 0.1,
  );

  const report = {
    ...base,
    findings: merged,
    scores: { overall, ...scores },
    scanLog: [...(base.scanLog ?? []), ...(result.scanLog ?? [])],
    deep: { ran: true, ...(result.stats ?? {}) },
  };

  await client
    .from('soc2_assessments')
    .update({
      status: 'complete',
      overall_score: overall,
      security_score: scores.security,
      availability_score: scores.availability,
      confidentiality_score: scores.confidentiality,
      integrity_score: scores.integrity,
      privacy_score: scores.privacy,
      report,
    })
    .eq('id', assessmentId);

  return json({ ok: true });
};
