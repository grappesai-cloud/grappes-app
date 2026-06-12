// ─── Cron + worker: durable website-generation queue ─────────────────────────
// Claims one queued (or stalled) `generation_jobs` row and runs the full launch
// pipeline for it, decoupled from the user's request. Invoked two ways:
//   1. Vercel Cron every minute — drains the queue + recovers stalled jobs.
//   2. A best-effort kick from POST /api/projects/[id]/launch — fast start.
// Both authenticate with Bearer CRON_SECRET. The heavy work runs via waitUntil
// so the HTTP response returns immediately; the cron is the safety net if the
// background work is ever cut short (a 'running' job whose lock has gone stale
// is reclaimed and retried up to MAX_ATTEMPTS).

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { getPg } from '../../../lib/supabase';
import { db } from '../../../lib/db';
import { recordPersistentRateLimit } from '../../../lib/rate-limit';
import { runPipeline } from '../projects/[projectId]/launch';
import { json } from '../../../lib/api-utils';

// Each invocation may run one full generation in the background — give it the
// same budget as the launch route (Vercel Fluid Compute, up to 800s).
export const maxDuration = 800;

const MAX_ATTEMPTS = 3;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

interface ClaimedJob {
  id: string;
  project_id: string;
  user_id: string | null;
  attempts: number;
  was_live: boolean;
}

// Atomically claim the oldest queued job, or reclaim a 'running' job whose lock
// has gone stale (its worker died). The WHERE re-check inside the UPDATE makes
// this race-safe: two concurrent workers can't both claim the same row.
// The 14-minute stale window matches STALE_GENERATION_MS in launch.ts.
async function claimJob(): Promise<ClaimedJob | null> {
  const sql = getPg();
  const rows = await sql<ClaimedJob[]>`
    WITH candidate AS (
      SELECT id FROM generation_jobs
      WHERE status = 'queued'
         OR (status = 'running' AND locked_at < now() - interval '14 minutes')
      ORDER BY created_at
      LIMIT 1
    )
    UPDATE generation_jobs j
    SET status = 'running', attempts = attempts + 1, locked_at = now(), updated_at = now()
    FROM candidate c
    WHERE j.id = c.id
      AND (j.status = 'queued' OR (j.status = 'running' AND j.locked_at < now() - interval '14 minutes'))
    RETURNING j.id, j.project_id, j.user_id, j.attempts, j.was_live
  `;
  return rows[0] ?? null;
}

async function runJob(job: ClaimedJob): Promise<void> {
  const sql = getPg();

  // Give up after MAX_ATTEMPTS so a persistently-failing job can't loop forever
  // (`attempts` was already incremented by the claim).
  if (job.attempts > MAX_ATTEMPTS) {
    console.error(`[gen-queue] Job ${job.id} exceeded ${MAX_ATTEMPTS} attempts — failing`);
    await sql`UPDATE generation_jobs SET status='failed', error='max_attempts_exceeded', updated_at=now() WHERE id=${job.id}`;
    try {
      await db.projects.updateStatus(job.project_id, 'failed');
      await db.projects.updateSubstatus(job.project_id, 'err:generation failed after multiple attempts');
    } catch {}
    return;
  }

  try {
    await runPipeline(job.project_id, { wasLive: job.was_live });
    await sql`UPDATE generation_jobs SET status='done', error=null, updated_at=now() WHERE id=${job.id}`;

    // Record the per-user launch rate-limit slot only on success, so a failed
    // attempt gets a free retry. Owner-equivalent users skip the limit entirely.
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
  }
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) return new Response('CRON_SECRET not configured', { status: 500 });
  const auth = request.headers.get('authorization') ?? '';
  if (!safeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const job = await claimJob();
  if (!job) return json({ processed: 0 });

  // Run the heavy pipeline in the background and return immediately so the
  // caller (cron tick or POST kick) isn't blocked for the whole generation.
  // runJob never rejects (it handles its own errors), but guard anyway.
  const work = runJob(job).catch((err) => console.error('[gen-queue] runJob crashed:', err));
  let scheduled = false;
  try {
    waitUntil(work);
    scheduled = true;
  } catch {
    // No Vercel request context (e.g. local dev) — fall back to inline await.
  }
  if (!scheduled) await work;

  return json({ processed: 1, jobId: job.id, projectId: job.project_id });
};
