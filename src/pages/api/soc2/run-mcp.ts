// ── MCP / Agent Security Scan — run endpoint ───────────────────────────────
// Atomic consume 1 credit → run MCP deployment scan → save assessment → return id.
// On failure: mark assessment failed + refund the credit. Mirrors run-code.ts.
// Static-first, no active network — low risk, no domain verification required.

import type { APIRoute } from 'astro';
import { runMcpScan } from '../../../lib/soc2/mcp-scan';
import { fetchPublicRepo } from '../../../lib/soc2/fetch-repo';
import { createAdminClient } from '../../../lib/supabase';
import { checkPersistentRateLimit, recordPersistentRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const CREDIT_COST = 1;
const MAX_PASTE_CHARS = 200_000;

// MCP config / manifest file names we look for when a repo is linked.
const MCP_FILE_HINTS = /(^|\/)(\.?mcp(\.json)?|mcp\.config\.json|claude_desktop_config\.json|\.cursor\/mcp\.json|\.vscode\/mcp\.json)$/i;

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to run an MCP security scan.' }, 401);

  const rlKey = `soc2-mcp:${user.id}`;
  if (!(await checkPersistentRateLimit(rlKey, 5, 60_000))) {
    return json({ error: 'Slow down — try again in a moment.' }, 429);
  }
  await recordPersistentRateLimit(rlKey);

  let manifest: string | undefined;
  let repo: string | undefined;
  try {
    const body = (await request.json()) as { manifest?: string; repo?: string };
    manifest = body.manifest?.trim();
    repo = body.repo?.trim();
  } catch {
    return json({ error: 'Bad JSON body.' }, 400);
  }
  if (!manifest && !repo) return json({ error: 'Paste an MCP config/manifest JSON or link a public repo.' }, 400);
  if (manifest && manifest.length > MAX_PASTE_CHARS) {
    return json({ error: 'Manifest is too large. Link a repo instead.' }, 400);
  }

  // ── Resolve the manifest input BEFORE spending a credit ──
  let input: string;
  let target: string;
  try {
    if (repo) {
      const fetched = await fetchPublicRepo(repo);
      const mcpFile = fetched.files.find(f => MCP_FILE_HINTS.test(f.path))
        ?? fetched.files.find(f => /mcp/i.test(f.path) && f.path.endsWith('.json'));
      if (!mcpFile) {
        return json({ error: 'No MCP config (mcp.json / claude_desktop_config.json / .cursor/mcp.json) found in that repo. Paste the manifest instead.' }, 400);
      }
      input = mcpFile.content;
      target = `${fetched.label} (${mcpFile.path})`;
    } else {
      input = manifest!;
      target = 'Pasted MCP manifest';
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
    console.error('[soc2/run-mcp] consume RPC error:', consumeError);
    return json({ error: 'Credit service unavailable.' }, 503);
  }
  if (newBalance === null) {
    return json({ error: 'No SOC 2 credits remaining.', remaining: 0 }, 402);
  }

  // ── 2. Insert running row ───────────────────────────────────────────
  const { data: inserted, error: insertError } = await client
    .from('soc2_assessments')
    .insert({ user_id: user.id, mode: 'mcp', target, status: 'running', credits_spent: CREDIT_COST })
    .select('id')
    .single();
  if (insertError || !inserted) {
    console.error('[soc2/run-mcp] insert error:', insertError);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: CREDIT_COST });
    return json({ error: 'Could not start scan.' }, 500);
  }
  const assessmentId = inserted.id as string;

  // ── 3. Run the scan ─────────────────────────────────────────────────
  try {
    const report = await runMcpScan(input);
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
    console.error('[soc2/run-mcp] pipeline failed:', e);
    const message = e instanceof Error ? e.message : String(e);
    await client.from('soc2_assessments').update({ status: 'failed' }).eq('id', assessmentId);
    await client.rpc('refund_soc2_credits', { p_user_id: user.id, p_amount: CREDIT_COST });
    return json({ error: 'Scan failed: ' + message }, 500);
  }
};
