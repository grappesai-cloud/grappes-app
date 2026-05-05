-- ===========================================================================
-- Grappes core schema — Neon-ready (auto-generated from supabase/migrations/)
-- ===========================================================================
-- Source migrations: 001_init.sql, 002_edit_quotas.sql, 003_consume_edit_atomic.sql, 004_stripe_idempotency.sql, 005_referral_balance_atomic.sql, 006_extra_edits_atomic.sql, 007_create_pageviews.sql, 008_referrals.sql, 009_refund_edits.sql, 010_rate_limits.sql, 011_rename_commit_sha.sql, 012_referral_signup_ip.sql, 013_rls_all_tables.sql, 014_realtime_projects.sql, 015_billing_columns.sql, 016_atomic_operations.sql, 017_referral_payout_iban_holder.sql, 018_contact_submissions.sql, 019_email_hardening.sql, 020_support_chat.sql, 021_project_integrations.sql, 022_assets_metadata.sql, 023_branding_removed.sql, 024_project_iterations.sql
-- Generator: scripts/build-neon-migration.mjs

CREATE EXTENSION IF NOT EXISTS pgcrypto;


-- ──────────────────────────────────────────────
-- Source: 001_init.sql
-- ──────────────────────────────────────────────
-- ========================================
-- USERS (mirrors "user")
-- ========================================
CREATE TABLE users (
  id                 UUID PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  name               TEXT,
  plan               TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'agency')),
  stripe_customer_id TEXT,
  projects_limit     INTEGER DEFAULT 1,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);


-- Auto-create user profile when a Supabase auth user signs up
-- (handle_new_user function removed — Better-Auth manages user creation)

-- (on_auth_user_created trigger removed)

-- ========================================
-- PROJECTS (one per website)
-- ========================================
CREATE TABLE projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  status             TEXT DEFAULT 'onboarding' CHECK (status IN (
                       'onboarding',
                       'brief_ready',
                       'generating',
                       'generated',
                       'deploying',
                       'live',
                       'failed',
                       'archived'
                     )),
  github_repo        TEXT,
  github_url         TEXT,
  vercel_project_id  TEXT,
  preview_url        TEXT,
  custom_domain      TEXT,
  domain_verified    BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  deployed_at        TIMESTAMPTZ,

  UNIQUE(user_id, slug)
);


-- ========================================
-- BRIEFS (onboarding output)
-- ========================================
CREATE TABLE briefs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  data         JSONB NOT NULL DEFAULT '{}',
  completeness REAL DEFAULT 0.0,
  confirmed    BOOLEAN DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);


-- ========================================
-- CONVERSATIONS (onboarding chat history)
-- ========================================
CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  messages   JSONB NOT NULL DEFAULT '[]',
  phase      TEXT DEFAULT 'discovery',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);


-- ========================================
-- GENERATED FILES (output from generation engine)
-- ========================================
CREATE TABLE generated_files (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID REFERENCES projects(id) ON DELETE CASCADE,
  version            INTEGER DEFAULT 1,
  files              JSONB NOT NULL,
  generation_cost    REAL,
  generation_tokens  INTEGER,
  created_at         TIMESTAMPTZ DEFAULT now()
);


-- ========================================
-- DEPLOYMENTS (deploy history)
-- ========================================
CREATE TABLE deployments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  version        INTEGER DEFAULT 1,
  status         TEXT DEFAULT 'queued' CHECK (status IN (
                   'queued', 'building', 'ready', 'error', 'canceled'
                 )),
  preview_url    TEXT,
  commit_sha     TEXT,
  build_logs     TEXT[],
  build_duration INTEGER,
  error_message  TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  completed_at   TIMESTAMPTZ
);


-- ========================================
-- ASSETS (uploaded files)
-- ========================================
CREATE TABLE assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT CHECK (type IN ('logo', 'hero', 'section', 'og', 'favicon', 'font', 'other')),
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url   TEXT,
  mime_type    TEXT,
  size_bytes   INTEGER,
  created_at   TIMESTAMPTZ DEFAULT now()
);


-- ========================================
-- COSTS (per-project AI cost tracking)
-- ========================================
CREATE TABLE costs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT CHECK (type IN ('onboarding', 'generation', 'fix', 'validation')),
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      REAL,
  created_at    TIMESTAMPTZ DEFAULT now()
);


-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX idx_projects_user       ON projects(user_id);

CREATE INDEX idx_projects_status     ON projects(status);

CREATE INDEX idx_briefs_project      ON briefs(project_id);

CREATE INDEX idx_conversations_proj  ON conversations(project_id);

CREATE INDEX idx_generated_project   ON generated_files(project_id);

CREATE INDEX idx_deployments_project ON deployments(project_id);

CREATE INDEX idx_assets_project      ON assets(project_id);

CREATE INDEX idx_costs_project       ON costs(project_id);


-- ──────────────────────────────────────────────
-- Source: 002_edit_quotas.sql
-- ──────────────────────────────────────────────
-- ── Edit quota fields on users ─────────────────────────────────────────────
-- edits_used        : how many monthly edits the user has consumed this period
-- edits_period_start: start of the current billing period (reset monthly)
-- extra_edits       : purchased edit top-ups that don't expire monthly

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS edits_used         INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edits_period_start TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS extra_edits        INTEGER      NOT NULL DEFAULT 0;


-- ──────────────────────────────────────────────
-- Source: 003_consume_edit_atomic.sql
-- ──────────────────────────────────────────────
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


-- ──────────────────────────────────────────────
-- Source: 004_stripe_idempotency.sql
-- ──────────────────────────────────────────────
-- Stripe webhook idempotency table.
-- Every processed event ID is recorded here. Before handling an event we
-- attempt to INSERT the event ID; if the unique constraint fires we know
-- Stripe is retrying an already-handled event and we can skip it safely.

CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id    text PRIMARY KEY,
  event_type  text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);


-- Optional: auto-purge events older than 30 days to keep the table small
-- (handled via a Supabase scheduled job or pg_cron if available)


-- ──────────────────────────────────────────────
-- Source: 005_referral_balance_atomic.sql
-- ──────────────────────────────────────────────
-- Atomic referral balance operations.
-- Replaces read-then-write patterns that allow concurrent webhook calls
-- to overwrite each other's balance increments.

-- Increment referral_balance atomically. Returns the new balance.
CREATE OR REPLACE FUNCTION increment_referral_balance(p_user_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE users
  SET referral_balance = COALESCE(referral_balance, 0) + p_amount
  WHERE id = p_user_id
  RETURNING referral_balance INTO v_new_balance;
  RETURN v_new_balance;
END;
$$;


-- Deduct a payout amount atomically (floor at 0). Returns the new balance.
CREATE OR REPLACE FUNCTION deduct_referral_balance(p_user_id uuid, p_amount numeric)
RETURNS numeric
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_new_balance numeric;
BEGIN
  UPDATE users
  SET referral_balance = GREATEST(0, COALESCE(referral_balance, 0) - p_amount)
  WHERE id = p_user_id
  RETURNING referral_balance INTO v_new_balance;
  RETURN v_new_balance;
END;
$$;


-- ──────────────────────────────────────────────
-- Source: 006_extra_edits_atomic.sql
-- ──────────────────────────────────────────────
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


-- ──────────────────────────────────────────────
-- Source: 007_create_pageviews.sql
-- ──────────────────────────────────────────────
-- 007: Create pageviews table for lightweight analytics
-- Receives beacons from generated sites via POST /api/analytics/[projectId]

CREATE TABLE IF NOT EXISTS public.pageviews (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  url         TEXT,
  referrer    TEXT,
  screen_width INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);


-- Index for querying pageviews by project (dashboard analytics)
CREATE INDEX idx_pageviews_project_created
  ON public.pageviews (project_id, created_at DESC);


-- Index for time-range queries across all projects
CREATE INDEX idx_pageviews_created
  ON public.pageviews (created_at DESC);


-- ──────────────────────────────────────────────
-- Source: 008_referrals.sql
-- ──────────────────────────────────────────────
-- ── Referral system migration ────────────────────────────────────────────────
-- Run this in Supabase SQL Editor (Project > SQL Editor > New query)

-- 1. Add referral columns to users table
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referral_balance DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referred_by TEXT,
  ADD COLUMN IF NOT EXISTS last_edits_session_id TEXT;
  -- webhook idempotency

-- 2. Create referrals table
CREATE TABLE IF NOT EXISTS referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_used TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | confirmed
  plan_type TEXT,                            -- starter | pro | agency
  amount_earned DECIMAL(10,2) DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at TIMESTAMPTZ,
  UNIQUE(referred_id)                        -- one referral per user
);


-- 3. Create referral_payouts table
CREATE TABLE IF NOT EXISTS referral_payouts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount DECIMAL(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | paid
  iban TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  paid_at TIMESTAMPTZ
);


-- 4. Indexes for performance
CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx ON referrals(referrer_id);

CREATE INDEX IF NOT EXISTS referrals_referred_id_idx ON referrals(referred_id);

CREATE INDEX IF NOT EXISTS referral_payouts_referrer_id_idx ON referral_payouts(referrer_id);


-- ──────────────────────────────────────────────
-- Source: 009_refund_edits.sql
-- ──────────────────────────────────────────────
-- Refund edit credits (used when an AI operation fails after consuming credits upfront).
-- Reverses consume_edit: adds back to monthly pool first, then extra_edits.

CREATE OR REPLACE FUNCTION refund_edits(p_user_id uuid, p_amount int)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF p_amount <= 0 THEN RETURN; END IF;

  UPDATE users
  SET edits_used = GREATEST(0, edits_used - p_amount)
  WHERE id = p_user_id;
END;
$$;


-- ──────────────────────────────────────────────
-- Source: 010_rate_limits.sql
-- ──────────────────────────────────────────────
-- Persistent rate limiting table for cross-instance enforcement.
-- Used by checkPersistentRateLimit() for expensive operations
-- (AI generation, Stripe checkout, launch, etc.)

CREATE TABLE IF NOT EXISTS rate_limits (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);


CREATE INDEX idx_rate_limits_key_created ON rate_limits (key, created_at DESC);


-- Auto-cleanup: delete entries older than 24 hours (runs via pg_cron or manual)
-- For now, the cron endpoint can clean these up, or a scheduled function.


-- ──────────────────────────────────────────────
-- Source: 011_rename_commit_sha.sql
-- ──────────────────────────────────────────────
-- Rename commit_sha to vercel_deploy_id for semantic accuracy.
-- The column stores the Vercel deployment ID, not a git commit SHA.

ALTER TABLE deployments RENAME COLUMN commit_sha TO vercel_deploy_id;


-- ──────────────────────────────────────────────
-- Source: 012_referral_signup_ip.sql
-- ──────────────────────────────────────────────
-- Track sign-up IP on referrals for anti-gaming (max 3 referrals per IP per 24h)
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS signup_ip text;

CREATE INDEX IF NOT EXISTS idx_referrals_signup_ip ON referrals (signup_ip, created_at DESC);


-- ──────────────────────────────────────────────
-- Source: 013_rls_all_tables.sql
-- ──────────────────────────────────────────────
-- ============================================================
-- DONE. Verify with:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- ============================================================


-- ──────────────────────────────────────────────
-- Source: 014_realtime_projects.sql
-- ──────────────────────────────────────────────
-- RLS is already enabled on projects (from 013),
-- so only the project owner will receive change events.


-- ──────────────────────────────────────────────
-- Source: 015_billing_columns.sql
-- ──────────────────────────────────────────────
-- ============================================================
-- 015: Add billing columns to projects table
-- These columns are referenced by the application but were
-- never added via migration.
-- Run this in Supabase SQL Editor.
-- ============================================================

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS billing_type TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS billing_status TEXT NOT NULL DEFAULT 'free',
  ADD COLUMN IF NOT EXISTS site_subscription_id TEXT,
  ADD COLUMN IF NOT EXISTS site_payment_intent_id TEXT,
  ADD COLUMN IF NOT EXISTS activated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS expires_at TIMESTAMPTZ;


-- Index for billing queries
CREATE INDEX IF NOT EXISTS idx_projects_billing_status ON public.projects (user_id, billing_status);


-- ──────────────────────────────────────────────
-- Source: 016_atomic_operations.sql
-- ──────────────────────────────────────────────
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


-- ──────────────────────────────────────────────
-- Source: 017_referral_payout_iban_holder.sql
-- ──────────────────────────────────────────────
-- Store IBAN holder name alongside IBAN for payouts.
ALTER TABLE referral_payouts
  ADD COLUMN IF NOT EXISTS iban_holder TEXT;


-- ──────────────────────────────────────────────
-- Source: 018_contact_submissions.sql
-- ──────────────────────────────────────────────
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


-- ──────────────────────────────────────────────
-- Source: 019_email_hardening.sql
-- ──────────────────────────────────────────────
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


-- No public policies — only service_role (admin client) can access
-- This is intentional: the suppressed_emails table should only be accessed
-- server-side via createAdminClient()

COMMENT ON TABLE suppressed_emails IS 'Emails that should not receive any platform emails (bounces, complaints)';

COMMENT ON COLUMN users.email_bounced_at IS 'Timestamp when a hard bounce was detected for this user email';

COMMENT ON COLUMN users.marketing_opt_out IS 'User opted out of marketing/notification emails (not transactional)';


-- ──────────────────────────────────────────────
-- Source: 020_support_chat.sql
-- ──────────────────────────────────────────────
-- In-app support chat between users and the Grappes admin.
-- Each user has at most one open thread at a time (enforced at app level).

CREATE TABLE IF NOT EXISTS support_threads (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  project_id        UUID REFERENCES projects(id) ON DELETE SET NULL,
  status            TEXT NOT NULL DEFAULT 'open',   -- open | closed
  last_message_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  unread_for_user   BOOLEAN NOT NULL DEFAULT FALSE,
  unread_for_admin  BOOLEAN NOT NULL DEFAULT FALSE,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS support_threads_user_status_idx
  ON support_threads(user_id, status);

CREATE INDEX IF NOT EXISTS support_threads_admin_queue_idx
  ON support_threads(status, unread_for_admin DESC, last_message_at DESC);


CREATE TABLE IF NOT EXISTS support_messages (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  thread_id   UUID NOT NULL REFERENCES support_threads(id) ON DELETE CASCADE,
  sender      TEXT NOT NULL,                     -- 'user' | 'admin'
  content     TEXT NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


CREATE INDEX IF NOT EXISTS support_messages_thread_idx
  ON support_messages(thread_id, created_at);


-- ──────────────────────────────────────────────
-- Source: 021_project_integrations.sql
-- ──────────────────────────────────────────────
-- ─── Project-level integrations config ───────────────────────────────────────
-- Stores third-party credentials (Mailchimp API key + audience ID, etc.) that
-- need to be kept OUT of the brief.data JSON (which gets passed to LLMs).
-- Shape: { "mailchimp": { "api_key": "...", "audience_id": "...", "enabled": true } }

ALTER TABLE projects
  ADD COLUMN IF NOT EXISTS integrations JSONB NOT NULL DEFAULT '{}'::jsonb;


COMMENT ON COLUMN projects.integrations IS
  'Third-party integration credentials. Must NEVER be exposed to LLMs or the public site.';


-- ──────────────────────────────────────────────
-- Source: 022_assets_metadata.sql
-- ──────────────────────────────────────────────
-- Add metadata JSONB column to assets table.
-- Upload code writes sectionId, altText, note, order, variants, variantPaths into this column.
ALTER TABLE assets ADD COLUMN IF NOT EXISTS metadata JSONB;


NOTIFY pgrst, 'reload schema';


-- ──────────────────────────────────────────────
-- Source: 023_branding_removed.sql
-- ──────────────────────────────────────────────
-- Per-project flag: when true, the "by grappes.dev" footer badge is stripped at deploy time.
-- Flipped by the Stripe webhook on successful one-time $5 purchase (metadata.type='remove_branding').
ALTER TABLE projects ADD COLUMN IF NOT EXISTS branding_removed BOOLEAN NOT NULL DEFAULT FALSE;


NOTIFY pgrst, 'reload schema';


-- ──────────────────────────────────────────────
-- Source: 024_project_iterations.sql
-- ──────────────────────────────────────────────
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
