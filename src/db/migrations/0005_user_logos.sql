-- ============================================
-- Logo Lab — standalone AI-generated logos
-- ============================================
-- A user_logos row is NOT attached to a press_kits row. Logo Lab is its own
-- product (Recraft V4 Vector engine, conversational flow). The same Recraft
-- pipeline that powers per-kit logos is reused here via /api/logo/generate.

CREATE TABLE IF NOT EXISTS user_logos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name             TEXT NOT NULL,
  prompt           TEXT,
  -- generated assets (Vercel Blob URLs)
  png_url          TEXT NOT NULL,
  svg_url          TEXT,
  -- inputs captured so "Generate another" can prefill the flow
  logo_type        TEXT,
  mood             TEXT,
  description      TEXT,
  style_keywords   TEXT,
  primary_color    TEXT,
  reference_images JSONB DEFAULT '[]',
  created_at       TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS user_logos_user_created
  ON user_logos (user_id, created_at DESC);
