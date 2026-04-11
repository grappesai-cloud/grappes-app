-- ── Edit quota fields on users ─────────────────────────────────────────────
-- edits_used        : how many monthly edits the user has consumed this period
-- edits_period_start: start of the current billing period (reset monthly)
-- extra_edits       : purchased edit top-ups that don't expire monthly

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS edits_used         INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edits_period_start TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS extra_edits        INTEGER      NOT NULL DEFAULT 0;
