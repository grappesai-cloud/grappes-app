-- ============================================
-- 0017_soc2_lab.sql — SOC 2 Lab product
-- ============================================
-- A separate Studio product at grappes.dev/soc2. Two modes:
--   1. Code Audit  — user pastes/links source code, static analysis mapped to TSC.
--   2. Live Pentest — active scan of a domain the user has VERIFIED + AUTHORIZED.
-- This migration is the skeleton + billing slice only (credits + storage + the
-- ownership-verification + consent tables that gate live scans). The scan engines
-- are wired in later slices.
--
-- Billing mirrors audit_credits (0001 / migration 026) exactly: 1 free credit at
-- signup, Stripe webhook adds a pack. NOTE: live scans cost more credits than code
-- audits — the consume amount is passed by the caller, not hard-coded to 1.

-- ── Credits ──────────────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS soc2_credits INTEGER NOT NULL DEFAULT 1
    CHECK (soc2_credits >= 0);

COMMENT ON COLUMN users.soc2_credits IS
  'SOC 2 Lab credits. Defaults to 1 (free first code audit). Stripe webhook adds a pack. Live pentest consumes more than 1 per run.';

-- Grant the free first credit to users created before this column existed
UPDATE users SET soc2_credits = 1 WHERE soc2_credits = 0 AND created_at < now();

-- Atomic operations. consume takes an amount so a live scan can cost N credits.
CREATE OR REPLACE FUNCTION increment_soc2_credits(p_user_id uuid, p_amount int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  UPDATE users SET soc2_credits = COALESCE(soc2_credits, 0) + p_amount
   WHERE id = p_user_id RETURNING soc2_credits INTO v_new;
  RETURN v_new;
END; $$;

CREATE OR REPLACE FUNCTION consume_soc2_credits_atomic(p_user_id uuid, p_amount int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  UPDATE users SET soc2_credits = soc2_credits - p_amount
   WHERE id = p_user_id AND soc2_credits >= p_amount
   RETURNING soc2_credits INTO v_new;
  RETURN v_new;  -- NULL when insufficient balance
END; $$;

CREATE OR REPLACE FUNCTION refund_soc2_credits(p_user_id uuid, p_amount int)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER AS $$
DECLARE v_new int;
BEGIN
  UPDATE users SET soc2_credits = COALESCE(soc2_credits, 0) + p_amount
   WHERE id = p_user_id RETURNING soc2_credits INTO v_new;
  RETURN v_new;
END; $$;

-- ── Domain ownership verification (gates live pentest mode) ───────────────
-- Nothing active runs against a domain until a row here is status='verified'.
-- The user proves control via DNS TXT (grappes-verify=<token>) OR an uploaded
-- file at /.well-known/grappes-verify-<token>.txt — their choice.
CREATE TABLE IF NOT EXISTS soc2_domain_verifications (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  domain      TEXT NOT NULL,                 -- apex/host, normalized lowercase, no scheme
  method      TEXT NOT NULL CHECK (method IN ('dns_txt', 'file')),
  token       TEXT NOT NULL,                 -- random per (user, domain) attempt
  status      TEXT NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'verified', 'failed', 'revoked')),
  verified_at TIMESTAMPTZ,
  last_checked_at TIMESTAMPTZ,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- one active verification record per user+domain
  UNIQUE (user_id, domain)
);

CREATE INDEX IF NOT EXISTS soc2_domain_verifications_user
  ON soc2_domain_verifications (user_id, created_at DESC);

-- ── Assessments (stored reports for both modes) ──────────────────────────
CREATE TABLE IF NOT EXISTS soc2_assessments (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  mode        TEXT NOT NULL CHECK (mode IN ('code', 'live')),
  -- code mode: the repo URL or a Blob path / label. live mode: the verified domain.
  target      TEXT NOT NULL,
  -- live mode only: which verified domain authorized this run (audit trail)
  verification_id UUID REFERENCES soc2_domain_verifications(id) ON DELETE SET NULL,
  -- explicit, timestamped authorization captured at run time (legal record)
  consent_signed_at TIMESTAMPTZ,
  consent_ip  TEXT,
  status      TEXT NOT NULL DEFAULT 'running'
              CHECK (status IN ('running', 'complete', 'failed')),
  credits_spent INTEGER NOT NULL DEFAULT 1,
  -- Overall readiness score 0-100 (weighted across Trust Service Criteria)
  overall_score INTEGER,
  -- Per-TSC scores 0-100: Security, Availability, Confidentiality,
  -- Processing Integrity, Privacy
  security_score        INTEGER,
  availability_score    INTEGER,
  confidentiality_score INTEGER,
  integrity_score       INTEGER,
  privacy_score         INTEGER,
  -- Full payload: { findings: [...], roadmap: [...], policies: [...], scanLog: [...] }
  report      JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS soc2_assessments_user_created
  ON soc2_assessments (user_id, created_at DESC);
