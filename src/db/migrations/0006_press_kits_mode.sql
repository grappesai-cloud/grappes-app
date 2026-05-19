-- ============================================
-- Press Kits — split into Press Kit vs Brand Book modes
-- ============================================
-- /kits/new now forks immediately on creation. Press Kit mode keeps the
-- existing wizard (to be redesigned in PR 2). Brand Book mode renders a
-- polished Coming Soon screen on /kits/[id] until PR 3 builds the flow.

ALTER TABLE press_kits
  ADD COLUMN IF NOT EXISTS mode TEXT NOT NULL DEFAULT 'press_kit'
  CHECK (mode IN ('press_kit', 'brand_book'));
