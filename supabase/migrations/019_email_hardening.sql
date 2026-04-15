-- Email hardening: bounce tracking, marketing opt-out, suppressed emails
-- Migration 019

-- Track hard bounces on user accounts
ALTER TABLE users ADD COLUMN IF NOT EXISTS email_bounced_at timestamptz DEFAULT NULL;

-- Marketing opt-out flag (unsubscribe from non-essential emails)
ALTER TABLE users ADD COLUMN IF NOT EXISTS marketing_opt_out boolean DEFAULT false NOT NULL;

-- Suppressed email addresses (hard bounces + spam complaints)
-- Checked before every platform email send
CREATE TABLE IF NOT EXISTS suppressed_emails (
  email text PRIMARY KEY,
  reason text NOT NULL DEFAULT 'unknown',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Index for fast lookup
CREATE INDEX IF NOT EXISTS idx_suppressed_emails_email ON suppressed_emails (email);

-- RLS: only service role can read/write suppressed_emails
ALTER TABLE suppressed_emails ENABLE ROW LEVEL SECURITY;

-- No public policies — only service_role (admin client) can access
-- This is intentional: the suppressed_emails table should only be accessed
-- server-side via createAdminClient()

COMMENT ON TABLE suppressed_emails IS 'Emails that should not receive any platform emails (bounces, complaints)';
COMMENT ON COLUMN users.email_bounced_at IS 'Timestamp when a hard bounce was detected for this user email';
COMMENT ON COLUMN users.marketing_opt_out IS 'User opted out of marketing/notification emails (not transactional)';
