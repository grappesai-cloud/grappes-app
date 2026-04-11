-- Refund edit credits (used when an AI operation fails after consuming credits upfront).
-- Reverses consume_edit: adds back to monthly pool first, then extra_edits.

CREATE OR REPLACE FUNCTION refund_edits(p_user_id uuid, p_amount int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;

  UPDATE users
  SET edits_used = GREATEST(0, edits_used - p_amount)
  WHERE id = p_user_id;
END;
$$;
