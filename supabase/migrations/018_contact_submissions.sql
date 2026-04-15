-- Submissions captured by /api/contact/[projectId] from generated sites
-- (contact forms, newsletter signups, booking requests, etc.)
CREATE TABLE IF NOT EXISTS contact_submissions (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT NOT NULL DEFAULT 'contact',     -- contact | newsletter | booking | other
  name         TEXT,
  email        TEXT,
  subject      TEXT,
  message      TEXT,
  source_url   TEXT,                                -- where the form lives (referrer)
  ip           TEXT,
  user_agent   TEXT,
  status       TEXT NOT NULL DEFAULT 'new',         -- new | read | archived
  forwarded    BOOLEAN NOT NULL DEFAULT FALSE,      -- did Resend successfully send to owner?
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS contact_submissions_project_status_idx
  ON contact_submissions(project_id, status);
CREATE INDEX IF NOT EXISTS contact_submissions_project_created_idx
  ON contact_submissions(project_id, created_at DESC);
