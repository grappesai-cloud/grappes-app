-- ============================================
-- SEO Audit Lab — credit-based, 1 free per user
-- ============================================
-- Same pattern as reel_credits (migration 025). Each audit consumes 1 credit;
-- new users get 1 free at signup so they can try the product immediately.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS audit_credits INTEGER NOT NULL DEFAULT 1
    CHECK (audit_credits >= 0);

COMMENT ON COLUMN users.audit_credits IS
  'SEO audit credits. Defaults to 1 (free first audit). Stripe webhook adds 10 per pack.';

-- Grant the free first audit to existing users that were created before this column existed
UPDATE users SET audit_credits = 1 WHERE audit_credits = 0 AND created_at < now();

-- Update the new-user trigger so future signups also start with 1 free audit
-- (The trigger inserts a row; the column default already sets 1, so no code change
--  needed — this is documentation only.)

-- Atomic operations (mirror reel_credits exactly)
CREATE OR REPLACE FUNCTION increment_audit_credits(p_user_id uuid, p_amount int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  UPDATE users SET audit_credits = COALESCE(audit_credits, 0) + p_amount
   WHERE id = p_user_id RETURNING audit_credits INTO v_new;
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION consume_audit_credit_atomic(p_user_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  UPDATE users SET audit_credits = audit_credits - 1
   WHERE id = p_user_id AND audit_credits > 0
   RETURNING audit_credits INTO v_new;
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION refund_audit_credit(p_user_id uuid)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  UPDATE users SET audit_credits = COALESCE(audit_credits, 0) + 1
   WHERE id = p_user_id RETURNING audit_credits INTO v_new;
  RETURN v_new;
END; $$;

-- ============================================
-- seo_audits — stored reports, per user
-- ============================================
CREATE TABLE IF NOT EXISTS seo_audits (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  url         TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'complete', 'failed')),
  -- Overall score 0-100, weighted average of the four category scores
  overall_score INTEGER,
  -- Per-category scores 0-100
  perf_score    INTEGER,
  onpage_score  INTEGER,
  technical_score INTEGER,
  content_score   INTEGER,
  -- Full report payload: { perf: {...}, onpage: [...], technical: [...], content: {...} }
  report      JSONB,
  error       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS seo_audits_user_created
  ON seo_audits (user_id, created_at DESC);

ALTER TABLE seo_audits ENABLE ROW LEVEL SECURITY;

CREATE POLICY seo_audits_select_own ON seo_audits
  FOR SELECT USING (user_id = auth.uid());
