-- ─── Project-level integrations config ───────────────────────────────────────
-- Stores third-party credentials (Mailchimp API key + audience ID, etc.) that
-- need to be kept OUT of the brief.data JSON (which gets passed to LLMs).
-- Shape: { "mailchimp": { "api_key": "...", "audience_id": "...", "enabled": true } }

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS integrations JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN projects.integrations IS
  'Third-party integration credentials. Must NEVER be exposed to LLMs or the public site.';
