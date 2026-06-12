// Standalone website-generation worker for GitHub Actions — runs OUTSIDE Vercel,
// so it isn't bound by the 800s function cap (GitHub jobs run up to 6h).
//
// Triggered by `repository_dispatch` (event: generate) from
// POST /api/projects/[id]/launch, which passes the project id as client_payload.
// Claims one job from the generation_jobs queue and runs the full launch
// pipeline for it. The dashboard's existing poll shows the site when it's done.
//
// Run locally:  PROJECT_ID=<uuid> npx tsx scripts/run-generation-job.mts
// (needs ANTHROPIC_API_KEY, DATABASE_URL, BLOB_READ_WRITE_TOKEN in the env)

import { claimJob, runJob } from '../src/lib/generation-queue';
import { getPg } from '../src/lib/supabase';

async function main(): Promise<void> {
  const projectId = process.env.PROJECT_ID?.trim() || undefined;

  // GitHub is the primary worker, so claim immediately (no head-start delay).
  const job = await claimJob({ projectId, minQueuedAgeSeconds: 0 });
  if (!job) {
    console.log(`[gh-gen] No job to claim${projectId ? ` for project ${projectId}` : ''} — nothing to do`);
    return;
  }

  console.log(`[gh-gen] Claimed job ${job.id} for project ${job.project_id} (attempt ${job.attempts})`);
  await runJob(job); // records its own done/failed outcome; never throws
  console.log(`[gh-gen] Finished job ${job.id}`);
}

main()
  .catch((err) => {
    console.error('[gh-gen] Fatal:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    try { await getPg().end({ timeout: 5 }); } catch {}
    process.exit(process.exitCode ?? 0);
  });
