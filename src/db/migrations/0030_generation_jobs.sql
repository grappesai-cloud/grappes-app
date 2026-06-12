-- 0030_generation_jobs.sql
-- Durable background queue for website generation. Decouples the heavy
-- generate -> QA -> repair pipeline from the user's HTTP request: POST /launch
-- enqueues a job and returns immediately; a worker (kicked inline + a 1-minute
-- Vercel cron) claims and runs it. Crash/throttle-safe: a job whose worker died
-- mid-run is reclaimed once its lock goes stale, then retried up to MAX_ATTEMPTS.

CREATE TABLE IF NOT EXISTS generation_jobs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id  uuid NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  user_id     uuid,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','done','failed')),
  attempts    int  NOT NULL DEFAULT 0,
  was_live    boolean NOT NULL DEFAULT false,
  error       text,
  locked_at   timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

-- Fast lookup of the next job to claim (queued first, oldest first) and of
-- active jobs when the poll watchdog needs to know if generation is still live.
CREATE INDEX IF NOT EXISTS generation_jobs_active
  ON generation_jobs (status, created_at)
  WHERE status IN ('queued','running');

CREATE INDEX IF NOT EXISTS generation_jobs_project
  ON generation_jobs (project_id);
