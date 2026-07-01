import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { checkPersistentRateLimit, recordPersistentRateLimit } from '../../../../lib/rate-limit';
import { sendManualBuildRequestEmail } from '../../../../lib/resend';
import { consumeCredit } from '../../../../lib/credits';
import { json } from '../../../../lib/api-utils';


// ── GET — poll status ──────────────────────────────────────────────────────────

// If a generation has been stuck for longer than the function's own budget
// (maxDuration = 800s ≈ 13m20s) the Lambda died — auto-reset to failed.
// MUST stay above maxDuration: a shorter window falsely kills a slow-but-still
// -running generation mid-flight when a status poll trips the watchdog.
const STALE_GENERATION_MS = 14 * 60 * 1000;

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  // Watchdog: a build stuck in 'generating' but not in the concierge hand-off
  // state ('manual_build') for longer than the budget is treated as failed. The
  // concierge state is never auto-failed — an operator delivers it via the admin
  // endpoint, which flips the project to 'generated'.
  if (project.status === 'generating' && (project as any).substatus !== 'manual_build' && project.updated_at) {
    const age = Date.now() - new Date(project.updated_at).getTime();
    if (age > STALE_GENERATION_MS) {
      console.warn(`[launch] Orphaned generation for ${params.projectId} (${Math.round(age / 60000)}min) — resetting to failed`);
      await db.projects.updateStatus(params.projectId!, 'failed');
      await db.projects.updateSubstatus(params.projectId!, null);
      return json({ status: 'failed', substatus: null, previewUrl: null, githubUrl: null });
    }
  }

  return json({
    status: project.status,
    substatus: project.substatus ?? null,
    previewUrl: project.preview_url ?? null,
    githubUrl: project.github_url ?? null,
  });
};

// ── POST — fire generation pipeline ───────────────────────────────────────────

export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  // A site build is paid with one per-account site credit (granted from admin).
  // Charge ONCE, on the first build (from onboarding/brief_ready). Re-builds /
  // edits of an already-built site (generated/failed/live) are free.
  const firstBuild = project.status === 'onboarding' || project.status === 'brief_ready';

  // Rate limit generation attempts per hour (each costs ~$0.10–0.50 in AI)
  // Owner plan: unlimited — skip rate limit entirely
  // Paid plans: 10/hour, Free: 3/hour
  const dbUser = await db.users.findById(user.id);
  const userPlan = dbUser?.plan ?? 'free';
  const launchRateKey = `launch:${user.id}`;
  const isOwnerEquiv = userPlan === 'owner' || (dbUser?.extra_edits ?? 0) >= 999999;
  if (!isOwnerEquiv) {
    const maxLaunches = ['pro', 'agency'].includes(userPlan) ? 10 : userPlan === 'starter' ? 5 : 3;
    if (!(await checkPersistentRateLimit(launchRateKey, maxLaunches, 3_600_000))) {
      return json({ error: 'Too many generation requests. Please wait before trying again.' }, 429);
    }
  }

  // Auto-confirm brief if still in onboarding (user clicked Generate directly)
  if (project.status === 'onboarding') {
    try {
      const brief = await db.briefs.findByProjectId(params.projectId!);
      if (brief) {
        const { applySmartDefaults, calculateCompleteness } = await import('../../../../lib/onboarding');
        const enriched = applySmartDefaults(brief.data);
        await db.briefs.update(params.projectId!, enriched, calculateCompleteness(enriched));
        if (!brief.confirmed) await db.briefs.confirm(params.projectId!);
      }
      await db.projects.updateStatus(params.projectId!, 'brief_ready');
    } catch (e) {
      console.warn('[launch] Auto-confirm failed (non-blocking):', e);
    }
  }

  const brief = await db.briefs.findByProjectId(params.projectId!);

  // Brief completeness gate — very thin briefs produce mediocre output
  if (brief && (brief.completeness ?? 0) < 0.3) {
    return json({
      error: `Your site brief is only ${Math.round((brief.completeness ?? 0) * 100)}% complete. Please answer more onboarding questions before generating.`,
    }, 422);
  }

  // Atomic status transition — prevents double generation race condition.
  // 'live' is allowed so users can regenerate live sites: the live URL keeps
  // serving the previous deployment until they click Republish, but the
  // preview HTML gets refreshed. We track the original status to restore it
  // (live → generating → live) instead of demoting the project to 'generated'.
  const { createAdminClient } = await import('../../../../lib/supabase');
  const supabase = createAdminClient();
  const wasLive = project.status === 'live';
  const LAUNCHABLE = ['onboarding', 'brief_ready', 'generated', 'failed', 'live'];
  const { data: locked } = await supabase
    .from('projects')
    .update({ status: 'generating', substatus: 'confirming_brief', updated_at: new Date().toISOString() })
    .eq('id', params.projectId!)
    .in('status', LAUNCHABLE)
    .select('id')
    .maybeSingle();

  if (!locked) {
    // Re-read current status — original `project.status` may be stale
    const current = await db.projects.findById(params.projectId!);
    if (current?.status === 'generating') return json({ started: true, alreadyRunning: true });

    // Defensive fallback: the atomic IN-filter update returned no row, but the
    // re-read shows the project IS in a launchable status. This happens on a
    // tight race where /confirm just flipped the row but the conditional UPDATE
    // raced against it (rare but observed in prod). Retry once with a direct
    // updateStatus — at this point we KNOW the row is launchable.
    if (current?.status && LAUNCHABLE.includes(current.status)) {
      try {
        await db.projects.updateStatus(params.projectId!, 'generating');
        await db.projects.updateSubstatus(params.projectId!, 'confirming_brief');
        console.warn(`[launch] Atomic IN-filter update missed but status was "${current.status}" — forced transition to generating`);
      } catch (e) {
        console.error('[launch] Forced transition failed:', e);
        return json({ error: `Cannot launch from status "${current?.status || project.status}"` }, 409);
      }
    } else {
      return json({ error: `Cannot launch from status "${current?.status || project.status}"` }, 409);
    }
  }

  // ── Charge one site credit on the first build ────────────────────────────
  // Per-account credits (granted from admin) are the only gate. If the account
  // has none, revert the lock and tell the client. Owner-equivalent operator
  // accounts are not charged.
  if (firstBuild && !isOwnerEquiv) {
    const balance = await consumeCredit(user.id, 'site');
    if (balance === null) {
      try {
        await db.projects.updateStatus(params.projectId!, 'brief_ready');
        await db.projects.updateSubstatus(params.projectId!, null);
      } catch {}
      return json({ error: 'No site credits left on this account. Ask your admin to add credits.' }, 402);
    }
  }

  // ── Concierge flow: hand off to a human builder ──────────────────────────
  // We no longer run the AI pipeline. The project stays in 'generating' (so the
  // client sees a "we're building it" state and the dashboard keeps polling)
  // with substatus 'manual_build' until an operator delivers the finished HTML
  // via POST /api/admin/projects/[id]/deliver, which flips it to 'generated'.
  // The GET watchdog skips 'manual_build' so it is never auto-failed for age.
  try {
    await db.projects.updateSubstatus(params.projectId!, 'manual_build');
  } catch (e) {
    console.warn('[launch] could not set manual_build substatus:', e);
  }

  // Notify the operator with the full brief (best-effort — never block the user).
  try {
    const briefRow = await db.briefs.findByProjectId(params.projectId!);
    const assetRows = await db.assets.findByProject(params.projectId!).catch(() => []);
    const convoRow = await db.conversations.findByProjectId(params.projectId!).catch(() => null);
    const assets = assetRows
      .filter((a: any) => a.public_url)
      .map((a: any) => ({ type: a.type, url: a.public_url as string, filename: a.filename ?? null }));
    const r = await sendManualBuildRequestEmail({
      projectId: params.projectId!,
      projectName: project.name,
      clientEmail: dbUser?.email ?? user.email ?? '',
      clientName: (dbUser as any)?.name ?? undefined,
      brief: briefRow?.data ?? {},
      assetCount: assets.length,
      assets,
      conversation: (convoRow?.messages ?? []).map((m: any) => ({ role: m.role, content: m.content })),
    });
    if (!r.success) console.error('[launch] build-request email not sent:', r.error);
  } catch (e) {
    console.error('[launch] manual-build notification failed:', e);
  }

  // Durably record the launch slot (the old AI worker did this on success).
  if (!isOwnerEquiv) {
    try { await recordPersistentRateLimit(launchRateKey); } catch {}
  }

  return json({ started: true, status: 'generating' });
};

