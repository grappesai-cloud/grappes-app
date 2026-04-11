-- Atomic referral balance operations.
-- Replaces read-then-write patterns that allow concurrent webhook calls
-- to overwrite each other's balance increments.

-- Increment referral_balance atomically. Returns the new balance.
CREATE OR REPLACE FUNCTION increment_referral_balance(p_user_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE users
  SET referral_balance = COALESCE(referral_balance, 0) + p_amount
  WHERE id = p_user_id
  RETURNING referral_balance INTO v_new_balance;
  RETURN v_new_balance;
END;
$$;

-- Deduct a payout amount atomically (floor at 0). Returns the new balance.
CREATE OR REPLACE FUNCTION deduct_referral_balance(p_user_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE users
  SET referral_balance = GREATEST(0, COALESCE(referral_balance, 0) - p_amount)
  WHERE id = p_user_id
  RETURNING referral_balance INTO v_new_balance;
  RETURN v_new_balance;
END;
$$;
