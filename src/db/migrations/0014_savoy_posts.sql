-- Savoy admin: post scheduler. A finished studio reel gets a caption, target
-- platforms and a publish time; the queue drives the social calendar.

CREATE TABLE IF NOT EXISTS savoy_posts (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reel_id       UUID NOT NULL REFERENCES studio_reels(id) ON DELETE CASCADE,
  caption       TEXT NOT NULL,
  platforms     TEXT[] NOT NULL DEFAULT '{}',        -- 'instagram' | 'tiktok' | 'facebook'
  scheduled_at  TIMESTAMPTZ NOT NULL,
  status        TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'posted', 'canceled')),
  posted_at     TIMESTAMPTZ,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_savoy_posts_user ON savoy_posts(user_id, scheduled_at);
