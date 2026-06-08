-- 0026_reel_analysis_public.sql
-- Reels Lab: shareable public analysis links. When is_public = true, the
-- analysis is viewable at /reels/share/<id> without auth (id is a nanoid).

ALTER TABLE reel_analyses
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT FALSE;
