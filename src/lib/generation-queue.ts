// Shared generation-queue logic, used by both the Vercel cron worker
// (src/pages/api/cron/process-generation.ts) and the GitHub Actions worker
// (scripts/run-generation-job.mts). Claims a `generation_jobs` row and runs the
// full launch pipeline for it, off the user's request path.
//
// GitHub Actions is the primary executor (no 800s function cap); the Vercel
// cron is an age-gated fallback that only picks up jobs GitHub didn't start and
// reclaims jobs whose worker died (stale lock).

import { getPg } from './supabase';
import { db } from './db';
import { recordPersistentRateLimit } from './rate-limit';
import { runPipeline } from '../pages/api/projects/[projectId]/launch';

export interface ClaimedJob {
  id: string;
  project_id: string;
  user_id: string | null;
  attempts: number;
  was_live: boolean;
}

const MAX_ATTEMPTS = 3;
// A 'running' job whose lock is older than this is treated as dead and reclaimed.
// runJob() heartbeats locked_at every 60s for as long as the generation is
// actually running, so a long-but-alive job (the GitHub worker allows up to
// 45min) keeps its lock fresh and is NEVER reclaimed mid-flight — that stale
// reclaim was what produced duplicate concurrent generations. This window now
// only fires for a genuinely dead worker (≥5 missed heartbeats).
const STALE_RUNNING = "interval '5 minutes'";
// How often a running job refreshes its lock. Must be well under STALE_RUNNING.
const HEARTBEAT_MS = 60_000;

interface ClaimOpts {
  /** Only claim a job for this specific project (used by the GitHub dispatch). */
  projectId?: string;
  /**
   * Only claim a queued job that has been waiting at least this long. The Vercel
   * fallback passes a few minutes so GitHub gets first crack; the GitHub worker
   * passes 0 (claim immediately).
   */
  minQueuedAgeSeconds?: number;
}

/**
 * Atomically claim the oldest eligible job, or reclaim a 'running' job whose
 * lock has gone stale. The WHERE re-check inside the UPDATE makes it race-safe:
 * two concurrent workers can't both claim the same row.
 */
export async function claimJob(opts: ClaimOpts = {}): Promise<ClaimedJob | null> {
  const sql = getPg();
  const minAge = Math.max(0, Math.floor(opts.minQueuedAgeSeconds ?? 0));
  const projectFilter = opts.projectId ? sql`AND project_id = ${opts.projectId}` : sql``;
  const projectFilterJ = opts.projectId ? sql`AND j.project_id = ${opts.projectId}` : sql``;

  const rows = await sql<ClaimedJob[]>`
    WITH candidate AS (
      SELECT id FROM generation_jobs
      WHERE (
            (status = 'queued'  AND created_at <= now() - make_interval(secs => ${minAge}))
         OR (status = 'running' AND locked_at < now() - ${sql.unsafe(STALE_RUNNING)})
      )
      ${projectFilter}
      ORDER BY created_at
      LIMIT 1
    )
    UPDATE generation_jobs j
    SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
    FROM candidate c
    WHERE j.id = c.id
      AND (
            (j.status = 'queued'  AND j.created_at <= now() - make_interval(secs => ${minAge}))
         OR (j.status = 'running' AND j.locked_at < now() - ${sql.unsafe(STALE_RUNNING)})
      )
      ${projectFilterJ}
      RETURNING j.id, j.project_id, j.user_id, j.attempts, j.was_live
  `;
  return rows[0] ?? null;
}

/** Run one claimed job to completion. Never throws — it records its own outcome. */
export async function runJob(job: ClaimedJob): Promise<void> {
  const sql = getPg();

  // Give up after MAX_ATTEMPTS (the claim already incremented `attempts`).
  if (job.attempts > MAX_ATTEMPTS) {
    console.error(`[gen-queue] Job ${job.id} exceeded ${MAX_ATTEMPTS} attempts — failing`);
    await sql`UPDATE generation_jobs SET status='failed', error='max_attempts_exceeded', updated_at=now() WHERE id=${job.id}`;
    try {
      await db.projects.updateStatus(job.project_id, 'failed');
      await db.projects.updateSubstatus(job.project_id, 'err:generation failed after multiple attempts');
    } catch {}
    return;
  }

  // Heartbeat: refresh this job's lock while the pipeline is genuinely running,
  // so another worker can't mistake a slow-but-alive generation for a dead one
  // and reclaim it (the cause of duplicate concurrent generations). Stops in the
  // `finally`, so a crashed worker's lock goes stale within STALE_RUNNING.
  const heartbeat = setInterval(() => {
    sql`UPDATE generation_jobs SET locked_at=now(), updated_at=now() WHERE id=${job.id} AND status='running'`
      .catch((e: any) => console.warn('[gen-queue] heartbeat failed (non-fatal):', e?.message || e));
  }, HEARTBEAT_MS);
  if (typeof (heartbeat as any).unref === 'function') (heartbeat as any).unref();

  try {
    await runPipeline(job.project_id, { wasLive: job.was_live });
    await sql`UPDATE generation_jobs SET status='done', error=null, updated_at=now() WHERE id=${job.id}`;

    // Record the per-user launch rate-limit slot only on success (free retry on
    // failure). Owner-equivalent users skip the limit entirely.
    if (job.user_id) {
      try {
        const u = await db.users.findById(job.user_id);
        const plan = (u as any)?.plan ?? 'free';
        const ownerEquiv = plan === 'owner' || ((u as any)?.extra_edits ?? 0) >= 999999;
        if (!ownerEquiv) await recordPersistentRateLimit(`launch:${job.user_id}`);
      } catch (e) {
        console.warn('[gen-queue] rate-limit record failed (non-fatal):', e);
      }
    }
    console.log(`[gen-queue] Job ${job.id} (project ${job.project_id}) done`);
  } catch (e: any) {
    const errMsg = (e?.message || String(e)).slice(0, 200);
    console.error(`[gen-queue] Job ${job.id} failed:`, errMsg);
    await sql`UPDATE generation_jobs SET status='failed', error=${errMsg}, updated_at=now() WHERE id=${job.id}`;
    try {
      await db.projects.updateStatus(job.project_id, 'failed');
      await db.projects.updateSubstatus(job.project_id, `err:${errMsg}`);
    } catch {}
  } finally {
    clearInterval(heartbeat);
  }
}
