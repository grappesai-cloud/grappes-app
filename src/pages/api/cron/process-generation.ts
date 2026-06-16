// ─── Vercel cron: fallback drain for the website-generation queue ────────────
// GitHub Actions is the PRIMARY generation worker (no 800s cap — see
// scripts/run-generation-job.mts + .github/workflows/generate.yml). This Vercel
// cron is the fallback: every minute it claims any job GitHub did NOT start
// within a few minutes (e.g. a failed/unconfigured dispatch) and reclaims jobs
// whose worker died. It runs the pipeline inside the 800s function budget, so it
// only reliably covers normal-sized jobs — heavy ones are GitHub's job.
//
// Auth: Bearer CRON_SECRET (Vercel Cron injects it). The heavy work runs via
// waitUntil so the response returns immediately.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { claimJob, runJob } from '../../../lib/generation-queue';
import { json } from '../../../lib/api-utils';

export const maxDuration = 800;

// Give GitHub this long to pick up a fresh job before Vercel rescues it.
const GITHUB_HEADSTART_SECONDS = 180;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) return new Response('CRON_SECRET not configured', { status: 500 });
  const auth = request.headers.get('authorization') ?? '';
  if (!safeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const job = await claimJob({ minQueuedAgeSeconds: GITHUB_HEADSTART_SECONDS });
  if (!job) return json({ processed: 0 });

  // Self-hosted Node server: there's no Vercel `waitUntil` that keeps
  // background work alive after the response, so fire-and-forget gets dropped.
  // Run the job INLINE to completion instead. `claimJob` atomically flips the
  // job to "running", so the next 1-min cron tick won't re-claim it — a long
  // inline run is safe even if the HTTP client/proxy times out the connection
  // (Node keeps executing the handler until the work finishes).
  await runJob(job).catch((err) => console.error('[gen-queue] runJob crashed:', err));

  return json({ processed: 1, jobId: job.id, projectId: job.project_id });
};
