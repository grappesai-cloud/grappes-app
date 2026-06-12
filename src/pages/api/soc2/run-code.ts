// ── SOC 2 Code Audit — run endpoint ────────────────────────────────────────
// Atomic consume 1 credit → run code audit → save assessment → return id.
// On failure: mark assessment failed + refund the credit.

import type { APIRoute } from 'astro';
import { runCodeAudit } from '../../../lib/soc2/code-audit';
import { fetchPublicRepo } from '../../../lib/soc2/fetch-repo';
import { dispatchSastScan } from '../../../lib/soc2/sast-dispatch';
import type { CodeFile } from '../../../lib/soc2/static-checks';
import { createAdminClient } from '../../../lib/supabase';
import { checkPersistentRateLimit, recordPersistentRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const CREDIT_COST = 1;
const MAX_PASTE_CHARS = 400_000;

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to run a code audit.' }, 401);

  // Cross-instance rate limit — these runs are paid + Claude-backed, so bound
  // them in the DB rather than per-serverless-instance memory.
  const rlKey = `soc2-code:${user.id}`;
  if (!(await checkPersistentRateLimit(rlKey, 5, 60_000))) {
    return json({ error: 'Slow down — try again in a moment.' }, 429);
  }
  await recordPersistentRateLimit(rlKey);

  let code: string | undefined;
  let repo: string | undefined;
  try {
    const body = (await request.json()) as { code?: string; repo?: string };
    code = body.code?.trim();
    repo = body.repo?.trim();
  } catch {
    return json({ error: 'Bad JSON body.' }, 400);
  }
  if (!code && !repo) return json({ error: 'Provide code or a public repo URL.' }, 400);
  if (code && code.length > MAX_PASTE_CHARS) {
    return json({ error: 'Paste is too large. Link a repo instead.' }, 400);
  }

  // ── Resolve the corpus BEFORE spending a credit (repo fetch can fail) ──
  let files: CodeFile[];
  let target: string;
  try {
    if (repo) {
      const fetched = await fetchPublicRepo(repo);
      files = fetched.files;
      target = fetched.label;
    } else {
      files = [{ path: 'pasted-snippet', content: code! }];
      target = 'Pasted code';
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return json({ error: message }, 400);
  }

  const client = createAdminClient();

  // ── 1. Consume credit atomically ────────────────────────────────────
  const { data: newBalance, error: consumeError } = await client.rpc(
    'consume_soc2_credits_atomic', { p_user_id: user.id, p_amount: CREDIT_COST },
  );
  if (consumeError) {
    console.error('[soc2/run-code] consume RPC error:', consumeError);
    return json({ error: 'Credit service unavailable.' }, 503);
  }
  if (newBalance === null) {
    return json({ error: 'No SOC 2 credits remaining.', remaining: 0 }, 402);
  }

  // ── 2. Insert running row ───────────────────────────────────────────
  const { data: inserted, error: insertError } = await client
    .from('soc2_assessments')
    .insert({ user_id: user.id, mode: 'code', target, status: 'running', credits_spent: CREDIT_COST })
    .select('id')
    .single();
  if (insertError || !inserted) {
    console.error('[soc2/run-code] insert error:', insertError);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: CREDIT_COST });
    return json({ error: 'Could not start assessment.' }, 500);
  }
  const assessmentId = inserted.id as string;

  // ── 3. Run the audit ────────────────────────────────────────────────
  try {
    // Pass the repo URL so the deep engines (SCA + authz) can fetch the full
    // tree + lockfile; for pasted code (no repo) they're skipped.
    const report = await runCodeAudit(files, { repoUrl: repo });
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

    // Kick the GitHub Actions SAST worker (Semgrep + gitleaks over the full git
    // history); it writes its findings onto report.sast asynchronously. No-op for
    // pasted code or when GitHub isn't configured — the in-function report is
    // already saved and returned.
    if (repo) await dispatchSastScan(repo, assessmentId).catch(() => false);

    return json({ id: assessmentId, remaining: newBalance, scores: report.scores, sast: repo ? 'dispatched' : undefined });
  } catch (e) {
    console.error('[soc2/run-code] pipeline failed:', e);
    const message = e instanceof Error ? e.message : String(e);
    await client.from('soc2_assessments').update({ status: 'failed' }).eq('id', assessmentId);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: CREDIT_COST });
    return json({ error: 'Assessment failed: ' + message }, 500);
  }
};
