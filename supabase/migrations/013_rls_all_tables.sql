-- ============================================================
-- 013: Enable RLS on ALL tables + policies
-- Run this in Supabase SQL Editor (Dashboard → SQL Editor → New Query)
-- ============================================================

-- ============================================================
-- 1. USERS
-- ============================================================
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;

-- Users can read their own profile
CREATE POLICY "Users can read own profile"
  ON public.users FOR SELECT
  TO authenticated
  USING (id = auth.uid());

-- Users can update their own profile
CREATE POLICY "Users can update own profile"
  ON public.users FOR UPDATE
  TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- Service role can do everything (for webhooks, cron, admin)
CREATE POLICY "Service role full access on users"
  ON public.users FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 2. PROJECTS
-- ============================================================
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Users can insert own projects"
  ON public.projects FOR INSERT
  TO authenticated
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can update own projects"
  ON public.projects FOR UPDATE
  TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own projects"
  ON public.projects FOR DELETE
  TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "Service role full access on projects"
  ON public.projects FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 3. BRIEFS
-- ============================================================
ALTER TABLE public.briefs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own briefs"
  ON public.briefs FOR SELECT
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own briefs"
  ON public.briefs FOR INSERT
  TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own briefs"
  ON public.briefs FOR UPDATE
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access on briefs"
  ON public.briefs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 4. CONVERSATIONS
-- ============================================================
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own conversations"
  ON public.conversations FOR SELECT
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own conversations"
  ON public.conversations FOR INSERT
  TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can update own conversations"
  ON public.conversations FOR UPDATE
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()))
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access on conversations"
  ON public.conversations FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 5. GENERATED_FILES
-- ============================================================
ALTER TABLE public.generated_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own generated files"
  ON public.generated_files FOR SELECT
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access on generated_files"
  ON public.generated_files FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 6. DEPLOYMENTS
-- ============================================================
ALTER TABLE public.deployments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own deployments"
  ON public.deployments FOR SELECT
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access on deployments"
  ON public.deployments FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 7. ASSETS
-- ============================================================
ALTER TABLE public.assets ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own assets"
  ON public.assets FOR SELECT
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can insert own assets"
  ON public.assets FOR INSERT
  TO authenticated
  WITH CHECK (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Users can delete own assets"
  ON public.assets FOR DELETE
  TO authenticated
  USING (project_id IN (SELECT id FROM public.projects WHERE user_id = auth.uid()));

CREATE POLICY "Service role full access on assets"
  ON public.assets FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 8. COSTS
-- ============================================================
ALTER TABLE public.costs ENABLE ROW LEVEL SECURITY;

-- Users should NOT see costs (internal tracking only)
CREATE POLICY "Service role full access on costs"
  ON public.costs FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 9. REFERRALS
-- ============================================================
ALTER TABLE public.referrals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own referrals"
  ON public.referrals FOR SELECT
  TO authenticated
  USING (referrer_id = auth.uid());

CREATE POLICY "Service role full access on referrals"
  ON public.referrals FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 10. REFERRAL_PAYOUTS
-- ============================================================
ALTER TABLE public.referral_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own payouts"
  ON public.referral_payouts FOR SELECT
  TO authenticated
  USING (referrer_id = auth.uid());

CREATE POLICY "Users can insert own payout requests"
  ON public.referral_payouts FOR INSERT
  TO authenticated
  WITH CHECK (referrer_id = auth.uid());

CREATE POLICY "Service role full access on referral_payouts"
  ON public.referral_payouts FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 11. STRIPE_PROCESSED_EVENTS
-- ============================================================
ALTER TABLE public.stripe_processed_events ENABLE ROW LEVEL SECURITY;

-- Only service role (webhooks) should access this
CREATE POLICY "Service role full access on stripe_processed_events"
  ON public.stripe_processed_events FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- 12. RATE_LIMITS
-- ============================================================
ALTER TABLE public.rate_limits ENABLE ROW LEVEL SECURITY;

-- Only service role (API routes) should access this
CREATE POLICY "Service role full access on rate_limits"
  ON public.rate_limits FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- ============================================================
-- DONE. Verify with:
-- SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'public';
-- ============================================================
