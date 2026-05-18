-- ============================================
-- Backfill: users multipage columns + 'owner' plan
-- ============================================
-- The Supabase migration 015_billing_columns.sql added these columns, but the
-- build-neon-migration.mjs script stripped the ALTER TABLE statements (they
-- were tied to RLS / role grants that don't apply to Neon). This patches the
-- users table so the multipage add-on works again.
-- Also widens the plan CHECK to include 'owner' (founder accounts).

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS multipage_addon BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS multipage_addon_lifetime BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS multipage_addon_subscription_id TEXT;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_plan_check;
ALTER TABLE users ADD CONSTRAINT users_plan_check
  CHECK (plan IN ('free', 'starter', 'pro', 'agency', 'owner'));
