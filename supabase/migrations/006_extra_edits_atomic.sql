-- Atomic increment of extra_edits to avoid read-then-write race in Stripe webhook
CREATE OR REPLACE FUNCTION increment_extra_edits(p_user_id uuid, p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new int;
BEGIN
  UPDATE users
  SET extra_edits = COALESCE(extra_edits, 0) + p_amount
  WHERE id = p_user_id
  RETURNING extra_edits INTO v_new;
  RETURN v_new;
END;
$$;
