-- Atomic conversation message append — prevents race condition on concurrent writes
CREATE OR REPLACE FUNCTION append_conversation_message(
  p_project_id UUID,
  p_message JSONB
)
RETURNS VOID AS $$
BEGIN
  UPDATE conversations
  SET messages = messages || jsonb_build_array(p_message),
      updated_at = NOW()
  WHERE project_id = p_project_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Conversation not found for project %', p_project_id;
  END IF;
END;
$$ LANGUAGE plpgsql;

-- Atomic brief merge — prevents race condition on concurrent asset uploads
CREATE OR REPLACE FUNCTION merge_brief_data(
  p_project_id UUID,
  p_extracted JSONB
)
RETURNS VOID AS $$
DECLARE
  v_brief_data JSONB;
  v_key TEXT;
  v_value JSONB;
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

  -- Deep merge each top-level key from extracted data
  FOR v_key, v_value IN SELECT * FROM jsonb_each(p_extracted)
  LOOP
    v_brief_data := jsonb_set(v_brief_data, ARRAY[v_key], v_value, true);
  END LOOP;

  UPDATE briefs
  SET data = v_brief_data, updated_at = NOW()
  WHERE project_id = p_project_id;
END;
$$ LANGUAGE plpgsql;

-- Add composite indexes for common ORDER BY queries
CREATE INDEX IF NOT EXISTS idx_deployments_project_created
  ON deployments(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_generated_files_project_created
  ON generated_files(project_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assets_project_created
  ON assets(project_id, created_at DESC);

-- Fix missing NOT NULL on critical foreign keys
ALTER TABLE projects ALTER COLUMN user_id SET NOT NULL;
ALTER TABLE deployments ALTER COLUMN project_id SET NOT NULL;

-- Update assets type CHECK constraint to include 'menu' and 'video'
ALTER TABLE assets DROP CONSTRAINT IF EXISTS assets_type_check;
ALTER TABLE assets ADD CONSTRAINT assets_type_check
  CHECK (type IN ('logo', 'hero', 'section', 'og', 'favicon', 'font', 'menu', 'video', 'other'));
