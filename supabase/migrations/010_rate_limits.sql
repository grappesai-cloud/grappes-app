-- Persistent rate limiting table for cross-instance enforcement.
-- Used by checkPersistentRateLimit() for expensive operations
-- (AI generation, Stripe checkout, launch, etc.)

CREATE TABLE IF NOT EXISTS rate_limits (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_limits_key_created ON rate_limits (key, created_at DESC);

-- Auto-cleanup: delete entries older than 24 hours (runs via pg_cron or manual)
-- For now, the cron endpoint can clean these up, or a scheduled function.
