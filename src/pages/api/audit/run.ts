// ── Run an SEO + perf audit ───────────────────────────────────────────────
// Atomic consume credit → run audit → save row → return id.
// On audit failure we refund the credit and save the row as 'failed'.

import type { APIRoute } from "astro";
import { runAudit } from "../../../lib/audit";
import { createAdminClient } from "../../../lib/supabase";
import { checkRateLimit } from "../../../lib/rate-limit";
import { json } from "../../../lib/api-utils";

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in to run an audit." }, 401);

  if (!checkRateLimit(`audit-run:${user.id}`, 5, 60_000)) {
    return json({ error: "Slow down — try again in a moment." }, 429);
  }

  let url: string | undefined;
  try {
    const body = (await request.json()) as { url?: string };
    url = body.url?.trim();
  } catch {
    return json({ error: "Bad JSON body." }, 400);
  }
  if (!url) return json({ error: "url required" }, 400);

  // Normalise: prepend https:// if user typed example.com
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
  try { new URL(url); } catch { return json({ error: "Invalid URL." }, 400); }

  const client = createAdminClient();

  // ── 1. Consume credit atomically ────────────────────────────────────
  const { data: newBalance, error: consumeError } = await client.rpc(
    "consume_audit_credit_atomic", { p_user_id: user.id },
  );
  if (consumeError) {
    console.error("[audit/run] consume RPC error:", consumeError);
    return json({ error: "Credit service unavailable." }, 503);
  }
  if (newBalance === null) {
    return json({ error: "No audit credits remaining.", remaining: 0 }, 402);
  }

  // ── 2. Insert running row so the UI can immediately link to it ──────
  const { data: inserted, error: insertError } = await client
    .from("seo_audits")
    .insert({ user_id: user.id, url, status: "running" })
    .select("id")
    .single();
  if (insertError || !inserted) {
    console.error("[audit/run] insert error:", insertError);
    await client.rpc("refund_audit_credit", { p_user_id: user.id });
    return json({ error: "Could not start audit." }, 500);
  }
  const auditId = inserted.id as string;

  // ── 3. Run the audit (synchronous; ~10-15s) ─────────────────────────
  try {
    const report = await runAudit(url);
    await client
      .from("seo_audits")
      .update({
        status: "complete",
        overall_score: report.scores.overall,
        perf_score: report.scores.perf,
        onpage_score: report.scores.onpage,
        technical_score: report.scores.technical,
        content_score: report.scores.content,
        report,
        updated_at: new Date().toISOString(),
      })
      .eq("id", auditId);

    return json({ id: auditId, remaining: newBalance, scores: report.scores });
  } catch (e) {
    console.error("[audit/run] pipeline failed:", e);
    const message = e instanceof Error ? e.message : String(e);
    await client
      .from("seo_audits")
      .update({ status: "failed", error: message, updated_at: new Date().toISOString() })
      .eq("id", auditId);
    // Refund — user shouldn't pay for our crash
    await client.rpc("refund_audit_credit", { p_user_id: user.id });
    return json({ error: "Audit failed: " + message }, 500);
  }
};
