-- ============================================================
-- 024: Per-project AI iteration quota
-- Each activated project gets 20 iterations included in the €350 plan.
-- Users can buy +10 iterations packs for $5 each.
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS iterations_used  INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS iterations_quota INT NOT NULL DEFAULT 20;

-- Atomic check-and-consume: returns row with allowed/used/quota/remaining
CREATE OR REPLACE FUNCTION consume_project_iteration(p_project_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_used  int;
  v_quota int;
BEGIN
  SELECT iterations_used, iterations_quota
    INTO v_used, v_quota
    FROM projects
    WHERE id = p_project_id
    FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'project_not_found');
  END IF;

  IF v_used >= v_quota THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'used', v_used,
      'quota', v_quota,
      'remaining', 0
    );
  END IF;

  UPDATE projects
    SET iterations_used = v_used + 1
    WHERE id = p_project_id;

  RETURN jsonb_build_object(
    'allowed', true,
    'used', v_used + 1,
    'quota', v_quota,
    'remaining', v_quota - (v_used + 1)
  );
END;
$$;

-- Refund one iteration (used when AI call fails)
CREATE OR REPLACE FUNCTION refund_project_iteration(p_project_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE projects
    SET iterations_used = GREATEST(0, iterations_used - 1)
    WHERE id = p_project_id;
END;
$$;

-- Add iterations to project quota (called by Stripe webhook after $5 pack purchase)
CREATE OR REPLACE FUNCTION add_project_iterations(p_project_id uuid, p_amount int)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new int;
BEGIN
  UPDATE projects
    SET iterations_quota = iterations_quota + p_amount
    WHERE id = p_project_id
    RETURNING iterations_quota INTO v_new;
  RETURN v_new;
END;
$$;

NOTIFY pgrst, 'reload schema';
