-- ============================================
-- Reel Analyses (full table) — Reels Lab moved into grappes-app
-- ============================================
-- Until now, reel-lab was a separate Vercel project with its own Neon DB
-- and `analyses` table. Cross-project rewrites strip cookies → auth broke.
-- So we move the whole thing into grappes-app. This table replaces the
-- reel_analyses_index table that used to point at the external Neon row.

CREATE TABLE IF NOT EXISTS reel_analyses (
  id              VARCHAR(24) PRIMARY KEY,
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blob_url        TEXT NOT NULL,
  blob_pathname   TEXT NOT NULL,
  file_name       TEXT NOT NULL,
  file_size_bytes INTEGER NOT NULL,
  status          VARCHAR(16) NOT NULL DEFAULT 'pending',
  progress        JSONB,
  result          JSONB,
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS reel_analyses_user_created
  ON reel_analyses (user_id, created_at DESC);

-- We keep the existing reel_analyses_index table empty going forward — it
-- can be dropped once we confirm no historical data is needed.
