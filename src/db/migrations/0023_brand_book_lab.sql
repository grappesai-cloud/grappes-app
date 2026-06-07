-- 0023_brand_book_lab.sql
-- Brand Book Lab launch. Fully idempotent: re-creates everything 0006/0008
-- may or may not have applied on prod (local migrations are behind Neon —
-- see reference_grappes_local_migration_drift), plus the new columns the
-- generator writes.
--
-- Apply manually against Neon (psql or dashboard SQL editor).

-- From 0006 (may already exist)
ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'press_kit';

-- From 0008 (was never auto-applied)
ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS industry        TEXT,
  ADD COLUMN IF NOT EXISTS voice_keywords  TEXT,
  ADD COLUMN IF NOT EXISTS voice_paragraph TEXT,
  ADD COLUMN IF NOT EXISTS palette_named   JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS applications    JSONB DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS donts           JSONB DEFAULT '[]'::jsonb;

-- New for Brand Book Lab
ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS logo_url     TEXT,                       -- uploaded mark (Vercel Blob, transparent PNG/SVG)
  ADD COLUMN IF NOT EXISTS typeface     TEXT,                       -- chosen Google Font family
  ADD COLUMN IF NOT EXISTS book_content JSONB DEFAULT '{}'::jsonb;  -- full AI-generated copy (BrandBookContent)

CREATE INDEX IF NOT EXISTS idx_press_kits_user_mode
  ON press_kits (user_id, mode);
