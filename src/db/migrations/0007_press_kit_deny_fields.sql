-- ============================================
-- Press Kit (DENY 2026 style) — structured content fields
-- ============================================
-- New columns to hold the DENY-style content that the rebuilt wizard
-- (PR 2 of the press-kit restructure) captures: key highlights bullets,
-- shared-stage names, career sub-sections (festivals / international /
-- charts), headline statistics, booking block, and the role chip.

ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS key_highlights JSONB  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS shared_stage   TEXT,
  ADD COLUMN IF NOT EXISTS career         JSONB  DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS big_stats      JSONB  DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS booking        JSONB  DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS role           TEXT   DEFAULT 'other',
  ADD COLUMN IF NOT EXISTS overview_intro TEXT;

-- Shape reference (no constraints — JSON is intentionally loose):
--   key_highlights: string[]
--   career: { festivals: string[], international: string[], charts: string[] }
--   big_stats: Array<{ label: string, value: string }>
--   booking: { agents: Array<{ name, email, phone, role }>, management: object, press_link: string, instagram: string }
--   role:    'dj' | 'producer' | 'musician' | 'photographer' | 'founder' | 'model' | 'athlete' | 'brand' | 'other' | <free>
