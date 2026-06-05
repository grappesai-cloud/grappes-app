-- ============================================
-- Social Lab Phase 2 — autopost queue ("post from a folder")
-- ============================================
-- The user drops media into a Blob folder (social/{userId}/queue/); the
-- hourly cron drains it: AI describes the media, writes a caption in the
-- brand voice, and schedules the post via Zernio at the next slot inside
-- the user's posting window.

CREATE TYPE social_queue_status AS ENUM ('queued', 'scheduled', 'posted', 'failed');

-- Autopost config, one per user.
CREATE TABLE IF NOT EXISTS social_queues (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  active            BOOLEAN NOT NULL DEFAULT true,
  platforms         social_platform[] NOT NULL,
  cadence_hours     INTEGER NOT NULL DEFAULT 24,
  window_start_hour INTEGER NOT NULL DEFAULT 18,
  window_end_hour   INTEGER NOT NULL DEFAULT 21,
  timezone          TEXT NOT NULL DEFAULT 'Europe/Bucharest',
  brand_voice       TEXT,
  hashtags          TEXT,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS social_queues_user_idx
  ON social_queues (user_id);

-- One media file dropped into the queue.
CREATE TABLE IF NOT EXISTS social_queue_items (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  queue_id        UUID NOT NULL REFERENCES social_queues(id) ON DELETE CASCADE,
  user_id         UUID NOT NULL REFERENCES "user"(id) ON DELETE CASCADE,
  blob_url        TEXT NOT NULL,
  blob_pathname   TEXT,
  file_name       TEXT,
  media_type      TEXT NOT NULL,
  ai_description  TEXT,
  caption         TEXT,
  scheduled_for   TIMESTAMPTZ,
  zernio_post_id  TEXT,
  status          social_queue_status NOT NULL DEFAULT 'queued',
  error           TEXT,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS social_queue_items_queue_status_idx
  ON social_queue_items (queue_id, status, created_at);
CREATE INDEX IF NOT EXISTS social_queue_items_user_idx
  ON social_queue_items (user_id, created_at);
