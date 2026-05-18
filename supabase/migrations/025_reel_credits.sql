-- ============================================
-- Reel Lab — credit-based billing
-- ============================================
-- Each user has a balance of `reel_credits`. Purchasing a "10 analyses for €50"
-- pack increments the balance via the Stripe webhook. The reel-lab Next.js
-- app calls `consume_reel_credit_atomic` before starting a paid analysis and
-- `refund_reel_credit` if the pipeline fails.
-- Mirrors the existing extra_edits pattern (migration 006).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS reel_credits INTEGER NOT NULL DEFAULT 0
    CHECK (reel_credits >= 0);

COMMENT ON COLUMN users.reel_credits IS
  'Reel-analysis credits remaining. Granted by Stripe webhook on pack purchase, decremented atomically when reel-lab starts an analysis.';

-- Atomic increment (called from Stripe webhook on checkout.session.completed)
CREATE OR REPLACE FUNCTION increment_reel_credits(p_user_id uuid, p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new int;
BEGIN
  UPDATE users
  SET reel_credits = COALESCE(reel_credits, 0) + p_amount
  WHERE id = p_user_id
  RETURNING reel_credits INTO v_new;
  RETURN v_new;
END;
$$;

-- Atomic consume: returns the NEW balance, or NULL if user had no credits.
-- Caller (reel-lab) refuses to start the analysis when this returns NULL.
CREATE OR REPLACE FUNCTION consume_reel_credit_atomic(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new int;
BEGIN
  UPDATE users
  SET reel_credits = reel_credits - 1
  WHERE id = p_user_id
    AND reel_credits > 0
  RETURNING reel_credits INTO v_new;
  -- v_new is NULL if the WHERE clause matched 0 rows (no credits / no user)
  RETURN v_new;
END;
$$;

-- Refund a credit when the analysis pipeline fails after consumption.
CREATE OR REPLACE FUNCTION refund_reel_credit(p_user_id uuid)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new int;
BEGIN
  UPDATE users
  SET reel_credits = COALESCE(reel_credits, 0) + 1
  WHERE id = p_user_id
  RETURNING reel_credits INTO v_new;
  RETURN v_new;
END;
$$;

-- ============================================
-- Reel analysis index (lightweight, for the Studio activity feed)
-- ============================================
-- Full analysis data lives in the reel-lab Neon DB. This Supabase table is
-- just an index: who ran what, when. The Studio activity feed and the Reels
-- dashboard tile read from here without round-tripping to Neon.

CREATE TABLE IF NOT EXISTS reel_analyses_index (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  -- Foreign analysis ID (Neon UUID from reel-lab.analyses.id) — opaque to us
  analysis_id TEXT NOT NULL,
  title       TEXT,                      -- short label for the feed (e.g. filename)
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'running', 'complete', 'failed')),
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),

  UNIQUE(user_id, analysis_id)
);

CREATE INDEX IF NOT EXISTS reel_analyses_index_user_created
  ON reel_analyses_index (user_id, created_at DESC);

-- RLS: users see only their own rows
ALTER TABLE reel_analyses_index ENABLE ROW LEVEL SECURITY;

CREATE POLICY reel_analyses_index_select_own ON reel_analyses_index
  FOR SELECT USING (user_id = auth.uid());

-- Service role bypasses RLS automatically; writes happen from reel-lab
-- via the service-role key, so no INSERT/UPDATE policies for authenticated.
