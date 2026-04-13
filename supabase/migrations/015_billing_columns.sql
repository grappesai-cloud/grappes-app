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
