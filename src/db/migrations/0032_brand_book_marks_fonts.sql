-- Brand Book Lab phase 2: optional extra logo marks + per-role custom fonts.
ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS symbol_url   TEXT,
  ADD COLUMN IF NOT EXISTS badge_url    TEXT,
  ADD COLUMN IF NOT EXISTS custom_fonts JSONB;
