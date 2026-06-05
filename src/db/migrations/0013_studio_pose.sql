-- Studio: optional pose reference for giraffe mode. Sponsor provided a pose
-- pack (public/studio/poses/*) — passing the closest pose alongside the master
-- image improves identity fidelity in generation.

ALTER TABLE studio_reels ADD COLUMN IF NOT EXISTS pose TEXT;
