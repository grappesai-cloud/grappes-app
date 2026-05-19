-- 0008_brand_book_fields.sql
-- Adds the structured columns required by the Brand Book flow (PR 3 of the
-- restructure). Press Kit columns from 0007 are untouched.
--
-- NOTE: this migration is NOT applied automatically. Apply via the user-gated
-- migration runner after PR 3 ships.

ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS industry        TEXT,
  ADD COLUMN IF NOT EXISTS voice_keywords  TEXT,
  ADD COLUMN IF NOT EXISTS voice_paragraph TEXT,
  ADD COLUMN IF NOT EXISTS palette_named   JSONB DEFAULT '[]'::jsonb, -- [{ hex, label, role }, ...]
  ADD COLUMN IF NOT EXISTS applications    JSONB DEFAULT '[]'::jsonb, -- ['tote_bag','billboard',...]
  ADD COLUMN IF NOT EXISTS donts           JSONB DEFAULT '[]'::jsonb; -- ['Do not stretch the logo', ...]
