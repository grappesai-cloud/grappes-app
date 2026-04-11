-- Atomic edit quota check-and-consume.
-- Replaces the read-then-write pattern in edit-quota.ts with a single
-- row-locked transaction, eliminating the race condition where two
-- concurrent requests could both pass the quota check.

CREATE OR REPLACE FUNCTION consume_edit(p_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user              RECORD;
  v_monthly_limit     int;
  v_edits_used        int;
  v_extra_edits       int;
  v_now               timestamptz := now();
BEGIN
  -- Lock the row so concurrent calls queue up instead of racing
  SELECT plan, edits_used, edits_period_start, extra_edits
  INTO v_user
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'user_not_found');
  END IF;

  -- Monthly limit (must mirror EDIT_LIMITS in edit-quota.ts)
  v_monthly_limit := CASE v_user.plan
    WHEN 'free'    THEN 0
    WHEN 'starter' THEN 3
    WHEN 'pro'     THEN 10
    WHEN 'agency'  THEN 25
    WHEN 'owner'   THEN 999999
    ELSE 0
  END;

  v_edits_used  := COALESCE(v_user.edits_used, 0);
  v_extra_edits := COALESCE(v_user.extra_edits, 0);

  -- Reset monthly counter if we've crossed into a new calendar month
  IF date_trunc('month', v_now AT TIME ZONE 'UTC')
     > date_trunc('month', COALESCE(v_user.edits_period_start, v_now) AT TIME ZONE 'UTC')
  THEN
    v_edits_used := 0;
    UPDATE users SET edits_used = 0, edits_period_start = v_now WHERE id = p_user_id;
  END IF;

  -- Quota exhausted?
  IF v_edits_used >= v_monthly_limit AND v_extra_edits <= 0 THEN
    RETURN jsonb_build_object(
      'allowed',   false,
      'used',      v_edits_used,
      'limit',     v_monthly_limit,
      'extra',     v_extra_edits,
      'remaining', 0,
      'plan',      v_user.plan
    );
  END IF;

  -- Consume one edit: monthly pool first, extra pack second
  IF v_edits_used < v_monthly_limit THEN
    UPDATE users SET edits_used = edits_used + 1 WHERE id = p_user_id;
    v_edits_used := v_edits_used + 1;
  ELSE
    UPDATE users SET extra_edits = extra_edits - 1 WHERE id = p_user_id;
    v_extra_edits := v_extra_edits - 1;
  END IF;

  RETURN jsonb_build_object(
    'allowed',   true,
    'used',      v_edits_used,
    'limit',     v_monthly_limit,
    'extra',     v_extra_edits,
    'remaining', GREATEST(0, (v_monthly_limit + v_extra_edits) - v_edits_used),
    'plan',      v_user.plan
  );
END;
$$;
