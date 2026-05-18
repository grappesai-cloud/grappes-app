-- ============================================
-- Press Kit Lab — per-kit one-time billing (€15/kit)
-- ============================================
-- Neon-compatible version of supabase/migrations/027_press_kits.sql.
-- RLS stripped — authorization lives in API route guards (WHERE user_id = $current).

CREATE TABLE IF NOT EXISTS press_kits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published')),
  slug          TEXT UNIQUE,
  kit_type      TEXT NOT NULL DEFAULT 'other',
  name          TEXT NOT NULL,
  tagline       TEXT,
  bio_short     TEXT,
  bio_long      TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_other TEXT,
  palette       JSONB DEFAULT '{}',
  fonts         JSONB DEFAULT '{}',
  links         JSONB DEFAULT '[]',
  stats         JSONB DEFAULT '[]',
  assets        JSONB DEFAULT '{}',
  press         JSONB DEFAULT '[]',
  awards        JSONB DEFAULT '[]',
  template_version INTEGER NOT NULL DEFAULT 1,
  stripe_session_id TEXT,
  published_at  TIMESTAMPTZ,
  created_at    TIMESTAMPTZ DEFAULT now(),
  updated_at    TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS press_kits_user_created
  ON press_kits (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS press_kits_slug
  ON press_kits (slug) WHERE slug IS NOT NULL;
