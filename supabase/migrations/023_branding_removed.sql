-- Per-project flag: when true, the "by grappes.dev" footer badge is stripped at deploy time.
-- Flipped by the Stripe webhook on successful one-time $5 purchase (metadata.type='remove_branding').
ALTER TABLE projects ADD COLUMN IF NOT EXISTS branding_removed BOOLEAN NOT NULL DEFAULT FALSE;

NOTIFY pgrst, 'reload schema';
