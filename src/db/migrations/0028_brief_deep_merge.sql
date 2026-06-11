-- 0028_brief_deep_merge.sql
--
-- FIX: merge_brief_data used jsonb_set(data, ARRAY[top_level_key], value) per
-- top-level key, which REPLACES the whole sub-object (business, content,
-- branding, ...) instead of merging it. Sibling fields collected across
-- different onboarding turns were silently destroyed (e.g. business.industry
-- captured turn 1, then business.entity_type turn 2 wiped name+industry+
-- description). This is the root cause of "Haiku re-asks already-answered
-- questions" and of briefs arriving at generation with most content missing.
--
-- Replaces the shallow merge with a recursive deep merge: nested objects merge
-- key-by-key; scalars, arrays and JSON null on the right-hand side overwrite.
-- Array overwrite (not append) matches the prior effective behaviour and what
-- Haiku expects (it re-sends the full array when it changes — appending would
-- duplicate testimonials/services).

CREATE OR REPLACE FUNCTION jsonb_deep_merge(a JSONB, b JSONB)
RETURNS JSONB AS $$
DECLARE
  result JSONB;
  k TEXT;
  v JSONB;
BEGIN
  -- If either side is not a JSON object, the right-hand side wins wholesale
  -- (covers scalars, arrays, and JSON null — null overwrites, e.g. clearing
  -- _lastUiAction).
  IF a IS NULL OR jsonb_typeof(a) <> 'object' THEN
    RETURN b;
  END IF;
  IF b IS NULL OR jsonb_typeof(b) <> 'object' THEN
    RETURN b;
  END IF;

  result := a;
  FOR k, v IN SELECT * FROM jsonb_each(b)
  LOOP
    IF result ? k
       AND jsonb_typeof(result -> k) = 'object'
       AND jsonb_typeof(v) = 'object' THEN
      -- both sides are objects → recurse
      result := jsonb_set(result, ARRAY[k], jsonb_deep_merge(result -> k, v), true);
    ELSE
      -- scalar / array / null / new key → overwrite
      result := jsonb_set(result, ARRAY[k], v, true);
    END IF;
  END LOOP;

  RETURN result;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION merge_brief_data(
  p_project_id UUID,
  p_extracted JSONB
)
RETURNS VOID AS $$
DECLARE
  v_brief_data JSONB;
BEGIN
  SELECT data INTO v_brief_data
  FROM briefs
  WHERE project_id = p_project_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Brief not found for project %', p_project_id;
  END IF;

  IF v_brief_data IS NULL THEN
    v_brief_data := '{}'::JSONB;
  END IF;

  -- Recursive deep merge — preserves sibling keys within each namespace.
  v_brief_data := jsonb_deep_merge(v_brief_data, p_extracted);

  UPDATE briefs
  SET data = v_brief_data, updated_at = NOW()
  WHERE project_id = p_project_id;
END;
$$ LANGUAGE plpgsql;
