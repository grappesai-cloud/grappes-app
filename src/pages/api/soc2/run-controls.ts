// ── SOC 2 Controls Self-Assessment — run endpoint ──────────────────────────
// Atomic consume 1 credit → score the answers → save assessment → return id.
// On failure: mark assessment failed + refund the credit. Mirrors run-code.ts.

import type { APIRoute } from 'astro';
import { runControlsAudit, type Answer, type Answers } from '../../../lib/soc2/controls-audit';
import { CONTROL_BY_ID } from '../../../lib/soc2/controls-catalog';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const CREDIT_COST = 1;
const VALID: Answer[] = ['yes', 'partial', 'no', 'na'];

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to run a controls assessment.' }, 401);

  if (!checkRateLimit(`soc2-controls:${user.id}`, 5, 60_000)) {
    return json({ error: 'Slow down — try again in a moment.' }, 429);
  }

  let raw: Record<string, unknown> | undefined;
  try {
    const body = (await request.json()) as { answers?: Record<string, unknown> };
    raw = body.answers;
  } catch {
    return json({ error: 'Bad JSON body.' }, 400);
  }
  if (!raw || typeof raw !== 'object') return json({ error: 'No answers provided.' }, 400);

  // Whitelist: keep only known control ids with a valid answer value.
  const answers: Answers = {};
  for (const [id, val] of Object.entries(raw)) {
    if (CONTROL_BY_ID[id] && typeof val === 'string' && VALID.includes(val as Answer)) {
      answers[id] = val as Answer;
    }
  }
  const answeredCount = Object.values(answers).filter(v => v !== 'na').length;
  if (answeredCount === 0) {
    return json({ error: 'Answer at least one control before running the assessment.' }, 400);
  }

  const client = createAdminClient();

  // ── 1. Consume credit atomically ────────────────────────────────────
  const { data: newBalance, error: consumeError } = await client.rpc(
    'consume_soc2_credits_atomic', { p_user_id: user.id, p_amount: CREDIT_COST },
  );
  if (consumeError) {
    console.error('[soc2/run-controls] consume RPC error:', consumeError);
    return json({ error: 'Credit service unavailable.' }, 503);
  }
  if (newBalance === null) {
    return json({ error: 'No SOC 2 credits remaining.', remaining: 0 }, 402);
  }

  // ── 2. Insert running row ───────────────────────────────────────────
  const target = `Controls self-assessment (${answeredCount} answered)`;
  const { data: inserted, error: insertError } = await client
    .from('soc2_assessments')
    .insert({ user_id: user.id, mode: 'controls', target, status: 'running', credits_spent: CREDIT_COST })
    .select('id')
    .single();
  if (insertError || !inserted) {
    console.error('[soc2/run-controls] insert error:', insertError);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: CREDIT_COST });
    return json({ error: 'Could not start assessment.' }, 500);
  }
  const assessmentId = inserted.id as string;

  // ── 3. Score and save ───────────────────────────────────────────────
  try {
    const report = await runControlsAudit(answers);
    await client
      .from('soc2_assessments')
      .update({
        status: 'complete',
        overall_score: report.scores.overall,
        security_score: report.scores.security,
        availability_score: report.scores.availability,
        confidentiality_score: report.scores.confidentiality,
        integrity_score: report.scores.integrity,
        privacy_score: report.scores.privacy,
        report,
      })
      .eq('id', assessmentId);

    return json({ id: assessmentId, remaining: newBalance, scores: report.scores });
  } catch (e) {
    console.error('[soc2/run-controls] pipeline failed:', e);
    const message = e instanceof Error ? e.message : String(e);
    await client.from('soc2_assessments').update({ status: 'failed' }).eq('id', assessmentId);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: CREDIT_COST });
    return json({ error: 'Assessment failed: ' + message }, 500);
  }
};
