-- 0029_universal_credits.sql
-- White-label per-tool credit system across ALL tools. Adds credit columns for
-- the tools that lacked them (logo, offer, brandbook, social, site) and generic
-- atomic RPCs (grant / consume / refund) keyed by a whitelisted "kind" so we
-- don't need N×3 near-identical functions. Credits are admin-granted (no Stripe
-- self-serve); new users start at 0 and the admin tops them up.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS logo_credits      INT NOT NULL DEFAULT 0 CHECK (logo_credits >= 0),
  ADD COLUMN IF NOT EXISTS offer_credits     INT NOT NULL DEFAULT 0 CHECK (offer_credits >= 0),
  ADD COLUMN IF NOT EXISTS brandbook_credits INT NOT NULL DEFAULT 0 CHECK (brandbook_credits >= 0),
  ADD COLUMN IF NOT EXISTS social_credits    INT NOT NULL DEFAULT 0 CHECK (social_credits >= 0),
  ADD COLUMN IF NOT EXISTS site_credits      INT NOT NULL DEFAULT 0 CHECK (site_credits >= 0);

-- Map a credit "kind" to its column. Returns NULL for unknown kinds, which the
-- RPCs treat as an error — this is the allowlist that makes the dynamic SQL
-- below injection-safe (only these eight literals ever reach format()).
CREATE OR REPLACE FUNCTION credit_column(p_kind text)
RETURNS text AS $$
  SELECT CASE p_kind
    WHEN 'reel'      THEN 'reel_credits'
    WHEN 'audit'     THEN 'audit_credits'
    WHEN 'soc2'      THEN 'soc2_credits'
    WHEN 'logo'      THEN 'logo_credits'
    WHEN 'offer'     THEN 'offer_credits'
    WHEN 'brandbook' THEN 'brandbook_credits'
    WHEN 'social'    THEN 'social_credits'
    WHEN 'site'      THEN 'site_credits'
    ELSE NULL
  END;
$$ LANGUAGE sql IMMUTABLE;

-- Add credits (grant from admin, or refund on failure). Returns the new balance.
CREATE OR REPLACE FUNCTION grant_credit(p_user_id uuid, p_kind text, p_amount int)
RETURNS int AS $$
DECLARE col text := credit_column(p_kind); newbal int;
BEGIN
  IF col IS NULL THEN RAISE EXCEPTION 'unknown credit kind %', p_kind; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  EXECUTE format('UPDATE users SET %I = %I + $1 WHERE id = $2 RETURNING %I', col, col, col)
    INTO newbal USING p_amount, p_user_id;
  RETURN newbal;
END;
$$ LANGUAGE plpgsql;

-- Atomically consume credits. Row-locked check-then-decrement. Returns the new
-- balance, or NULL if the user is missing or has insufficient credits.
CREATE OR REPLACE FUNCTION consume_credit(p_user_id uuid, p_kind text, p_amount int DEFAULT 1)
RETURNS int AS $$
DECLARE col text := credit_column(p_kind); cur int; newbal int;
BEGIN
  IF col IS NULL THEN RAISE EXCEPTION 'unknown credit kind %', p_kind; END IF;
  IF p_amount <= 0 THEN RAISE EXCEPTION 'amount must be positive'; END IF;
  EXECUTE format('SELECT %I FROM users WHERE id = $1 FOR UPDATE', col) INTO cur USING p_user_id;
  IF cur IS NULL OR cur < p_amount THEN RETURN NULL; END IF;
  EXECUTE format('UPDATE users SET %I = %I - $1 WHERE id = $2 RETURNING %I', col, col, col)
    INTO newbal USING p_amount, p_user_id;
  RETURN newbal;
END;
$$ LANGUAGE plpgsql;

-- Refund is just a guarded add (same as grant); separate name for call-site clarity.
CREATE OR REPLACE FUNCTION refund_credit(p_user_id uuid, p_kind text, p_amount int DEFAULT 1)
RETURNS int AS $$
DECLARE col text := credit_column(p_kind); newbal int;
BEGIN
  IF col IS NULL THEN RAISE EXCEPTION 'unknown credit kind %', p_kind; END IF;
  IF p_amount <= 0 THEN RETURN NULL; END IF;
  EXECUTE format('UPDATE users SET %I = %I + $1 WHERE id = $2 RETURNING %I', col, col, col)
    INTO newbal USING p_amount, p_user_id;
  RETURN newbal;
END;
$$ LANGUAGE plpgsql;
