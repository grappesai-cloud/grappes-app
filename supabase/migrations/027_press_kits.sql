-- ============================================
-- Press Kit Lab — per-kit one-time billing (€15/kit)
-- ============================================
-- Different billing model from credit-based products: user creates a draft
-- for free, edits indefinitely, pays €15 when ready to publish. After payment
-- the kit gets a public URL and PDF download. Re-editing a published kit is
-- free; "Publish" only fires once per kit.

CREATE TABLE IF NOT EXISTS press_kits (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status        TEXT NOT NULL DEFAULT 'draft'
                CHECK (status IN ('draft', 'published')),
  -- Short shareable slug: random 10-char base36, set when published
  slug          TEXT UNIQUE,
  -- Type drives default fonts + section ordering: musician, agency, photographer, founder, other
  kit_type      TEXT NOT NULL DEFAULT 'other',
  name          TEXT NOT NULL,
  tagline       TEXT,
  bio_short     TEXT,
  bio_long      TEXT,
  contact_email TEXT,
  contact_phone TEXT,
  contact_other TEXT,
  -- Color palette: { primary: '#hex', secondary, accent, text, bg, extracted_from_logo: bool }
  palette       JSONB DEFAULT '{}',
  -- Fonts: { heading: 'Inter', body: 'Inter', auto: bool }
  fonts         JSONB DEFAULT '{}',
  -- Links: [{ platform: 'spotify', url, label? }, ...]
  links         JSONB DEFAULT '[]',
  -- Stats: [{ value: '1.2M', label: 'monthly listeners' }, ...]
  stats         JSONB DEFAULT '[]',
  -- Assets: { logo: url, portrait: url, photos: [url], videos: [url], press_logos: [url] }
  assets        JSONB DEFAULT '{}',
  -- Press mentions: [{ name: 'Mixmag', url?, year?, quote? }, ...]
  press         JSONB DEFAULT '[]',
  -- Awards: [{ name, year, issuer }, ...]
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

-- RLS: owner sees their own kits at any status; everyone reads published kits
ALTER TABLE press_kits ENABLE ROW LEVEL SECURITY;

CREATE POLICY press_kits_select_own ON press_kits
  FOR SELECT USING (user_id = auth.uid());

CREATE POLICY press_kits_select_published ON press_kits
  FOR SELECT USING (status = 'published');
