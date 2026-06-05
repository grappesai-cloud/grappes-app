-- Savoy Content Studio: text → identity-locked giraffe image → approval gate → 9:16 video.
-- Two modes: 'scene' (hotel scene, no giraffe) and 'giraffe' (Domnul Girafă speaks, TTS + lip-sync).

CREATE TABLE IF NOT EXISTS studio_reels (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode            TEXT NOT NULL CHECK (mode IN ('scene', 'giraffe')),
  title           TEXT NOT NULL DEFAULT 'Reel nou',

  -- Inputs
  scene_prompt    TEXT NOT NULL,            -- scene description (both modes)
  dialogue        TEXT,                     -- mode 'giraffe': what the giraffe says (Romanian)

  -- Pipeline state. Approval gate sits between image_ready and anything that spends money on video.
  status          TEXT NOT NULL DEFAULT 'draft' CHECK (status IN (
                    'draft',
                    'image_generating', 'image_ready', 'image_failed',
                    'approved',
                    'audio_generating',                 -- mode 'giraffe' only (ElevenLabs)
                    'video_generating', 'video_failed',
                    'complete'
                  )),
  error_message   TEXT,

  -- Artifacts (Vercel Blob URLs)
  image_url       TEXT,
  audio_url       TEXT,
  video_url       TEXT,

  -- External provider job tracking (async submit → poll)
  provider        TEXT,                     -- e.g. 'higgsfield', 'kling', 'heygen', 'mock'
  provider_job_id TEXT,

  -- Cost discipline: judged criterion. Count every paid generation.
  image_attempts  INT NOT NULL DEFAULT 0,
  video_attempts  INT NOT NULL DEFAULT 0,
  approved_at     TIMESTAMPTZ,              -- when the human approved the image (the gate)

  events          JSONB NOT NULL DEFAULT '[]'::jsonb,  -- append-only audit log [{at, stage, msg}]

  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_studio_reels_user ON studio_reels(user_id, created_at DESC);

-- Reusable prompt library (stretch goal in the brief). Seeded with starter prompts;
-- the marketing team can save their own.
CREATE TABLE IF NOT EXISTS studio_prompts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID REFERENCES users(id) ON DELETE CASCADE,  -- NULL = built-in/global
  mode          TEXT NOT NULL CHECK (mode IN ('scene', 'giraffe')),
  label         TEXT NOT NULL,
  scene_prompt  TEXT NOT NULL,
  dialogue      TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO studio_prompts (user_id, mode, label, scene_prompt, dialogue) VALUES
  (NULL, 'scene',   'Apus la piscină',
   'Piscina hotelului Savoy la apus, șezlonguri premium, lumina aurie peste Marea Neagră, atmosferă de vară relaxată, fără persoane recognoscibile',
   NULL),
  (NULL, 'scene',   'Mic dejun cu vedere',
   'Mic dejun bogat pe terasa hotelului Savoy Mamaia, cafea aburindă, croissante, marea în fundal, dimineață însorită',
   NULL),
  (NULL, 'giraffe', 'Girafa invită la weekend',
   'Domnul Girafă stă relaxat pe un șezlong la piscina hotelului Savoy, cu un cocktail în copită, mare în fundal',
   'Salutare! Eu sunt Domnul Girafă și vă aștept weekendul ăsta la Savoy Mamaia. Piscina e caldă, cocktailurile sunt reci. Vă pup!'),
  (NULL, 'giraffe', 'Girafa anunță oferta',
   'Domnul Girafă la recepția elegantă a hotelului Savoy, făcând cu mâna spre cameră, lobby luminos',
   'Avem o veste bună: rezervările pentru iulie sunt deschise. Locurile bune pleacă repede, ca mine când văd frunze de salcâm!')
ON CONFLICT DO NOTHING;
