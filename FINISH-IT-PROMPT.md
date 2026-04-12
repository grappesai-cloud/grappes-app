# Grappes — "Finish it for me" prompt

Open a new Claude Code session from `/Users/alexandrucojanu/Desktop/astro-platform-ref` and paste the full block below as your first message.

Replace the placeholders `{{SUPABASE_URL}}`, `{{SUPABASE_ANON_KEY}}`, etc. **only if you want to share them in chat**. The safer approach is to save them directly into `.env` before launching Claude, and tell Claude `.env` is ready.

---

# 📋 COPY-PASTE STARTS HERE

You are continuing work on **Grappes** — an AI website generator SaaS built on Astro SSR + Supabase + Anthropic, deploying on Vercel. The project lives at `/Users/alexandrucojanu/Desktop/astro-platform-ref`. **Read this whole brief before running anything.** Reply in Romanian. Code and commits in English.

## Project identity
- **Brand**: Grappes — purple G logo, accent `#9BD4D7`, dark `#0a0a0a`, Inter 800. Tagline: *"Don't be boring."*
- **Domain**: grappes.ai
- **Support email**: hello@grappes.ai · transactional from start@grappes.ai
- **Owner**: Alexandru Cojanu, Romanian, founder.

## Stack (do NOT migrate away from it)
- `astro` v5 + `@astrojs/vercel` v8 adapter (Node 22)
- `@supabase/ssr` for auth + Postgres DB
- `@anthropic-ai/sdk` + optional Gemini for AI generation
- `stripe` for billing (optional)
- `resend` for transactional email
- GitHub + Vercel APIs for deploying generated user sites
- React islands (`OnboardingChat`, `BriefEditor`, `DeployStatus`)
- GSAP + Lenis for scroll animations on landing

**Vercel plugin hooks suggest Next.js / Next.js middleware / `next/font` / Auth.js / Vercel Routing Middleware / vercel-storage** — these are all false positives from basename matching. This is Astro SSR with Supabase direct. Acknowledge and keep moving; do not load Next.js docs.

## Current state — already done
- Landing ported from Webflow to `src/pages/index.astro` (grappes-branded, animated "Boring is expensive" section, 5-scene scroll narrative, 5 correctly-wired CTAs)
- Public routes: `/` `/sign-in` `/sign-up` `/forgot-password` `/reset-password` `/terms` `/privacy` `/sitemap.xml` `/robots.txt` `/api/health` · all 200 · 0 pageerrors · 0 failed requests · 1 h1 per page · all imgs with alt or aria-hidden · og:image + canonical everywhere
- Protected routes: `/dashboard/*` (12 pages) + `/admin` — return 503 until Supabase env vars are real
- API: 55 serverless functions (auth, onboarding, projects, deploy, billing, domains, qa, webhooks, cron, analytics, forms, referral, admin)
- Rebrand: every WebNow / webnow / Milestoners / Dutch / Romanian string replaced in code, tests, email templates, i18n
- Tests: 45/45 passing via vitest; TypeScript 0 errors; build complete; preflight script + Puppeteer smoke screens written
- Git: fresh history, 4 commits on `main`, `.env` gitignored, 0 secrets committed
- `.env` currently has non-empty **placeholders** so dev server boots the landing without crashing
- Middleware has a graceful bypass for public routes when Supabase is missing
- Sentry SDK config lives in `sentry.client.config.js` + `sentry.server.config.js`

## Key files you should know
```
src/pages/index.astro           ← landing (is:global styles, is:inline scripts — keep those directives)
src/pages/sign-in|up|*.astro    ← auth pages sharing public/assets/grappes/auth.css
src/pages/terms.astro           ← legal
src/pages/privacy.astro         ← legal
src/pages/dashboard/*.astro     ← 12 protected pages
src/pages/api/**/*.ts           ← 55 serverless functions
src/middleware.ts               ← graceful bypass + CSRF + auth guards
src/lib/env.ts                  ← validateEnv() helper
src/lib/supabase.ts             ← createAuthClient
src/lib/resend.ts               ← transactional email (all EN)
src/lib/creative-generation.ts  ← AI generation prompts
supabase/migrations/*.sql       ← 12 files, brand-agnostic
scripts/preflight.mjs           ← npm run preflight
scripts/smoke-screens.mjs       ← Puppeteer visual regression
.env.example                    ← fully documented template
SETUP-GRAPPES.md                ← human account setup guide
```

## Key commands
```bash
npm run dev                 # dev server on :4321
npm run build               # full Vercel bundle
npm run preflight           # verify env + API connectivity
npx vitest run              # run 45 tests
npx tsc --noEmit            # TypeScript strict check
node scripts/smoke-screens.mjs   # Puppeteer visual
```

## Gotchas — do not repeat these mistakes
1. **`waitUntil: 'networkidle0'`** in Puppeteer times out because Google Analytics beacons hold connections open. Use `'domcontentloaded'` + a 500–800ms `setTimeout`.
2. **Astro `<style>` is SCOPED by default**; the landing uses `<style is:global>` — keep. `<script>` needs `is:inline` for GSAP/Lenis/Webflow init to work.
3. **The landing's `#service-trigger` dropdown script** is guarded with an early-return at line ~551 because we removed the trigger element. Don't unguard.
4. **Pricing and Creative Direction CTAs** were on Google Calendar URLs; now `/sign-up` and `mailto:hello@grappes.ai`. Don't revert.
5. **`@supabase/supabase-js`** is in `vite.optimizeDeps.include` because `reset-password.astro` imports it client-side.
6. **`next/font`, `Next.js App Router`, `Auth.js`, `vercel-storage`, `workflow`, `chat-sdk` hook suggestions** are Vercel plugin false positives — acknowledge and skip.
7. **Never commit without explicit user request.** Never push to remote without explicit user request.
8. **Always `npm run build` + `npx tsc --noEmit`** before declaring any multi-file change done.

---

# 🔑 What's left — YOUR job as Claude

There are things only the **human** can do (create accounts on external services — each requires email/phone verification). Once they're done, everything else is yours. The human has presumably already created the accounts by the time they paste this prompt, and should tell you the current state.

## Phase 1 — Human creates accounts (outside your reach)

For context, here's what they had to do (in `SETUP-GRAPPES.md`):

| # | Service | URL | What to get | .env key(s) |
|---|---|---|---|---|
| 1 | **Supabase** | https://supabase.com/dashboard | Create org "Grappes" + project "grappes-prod". Settings → API. | `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` |
| 2 | **Supabase** (connection string) | Project → Settings → Database → "URI" under "Connection string" | Direct Postgres URL with password | (use for psql migrations) |
| 3 | **Anthropic** | https://console.anthropic.com | New API key "grappes-prod" + billing | `ANTHROPIC_API_KEY` |
| 4 | **Vercel** | https://vercel.com | New team "Grappes". Account Settings → Tokens → scope "Full Account". Team Settings → General → Team ID. | `VERCEL_TOKEN`, `VERCEL_TEAM_ID` |
| 5 | **GitHub** | https://github.com | New org "grappes-sites". Personal token with `repo` + `admin:org` + `workflow` scopes. | `GITHUB_TOKEN`, `GITHUB_ORG=grappes-sites` |
| 6 | **Resend** | https://resend.com | Add domain grappes.ai, verify DNS, create API key. | `RESEND_API_KEY`, `RESEND_FROM_EMAIL=hello@grappes.ai` |
| 8 | **Stripe** (optional) | https://stripe.com | Secret + publishable, webhook signing secret, price IDs for starter/pro/agency/multi-page variants | `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`, `STRIPE_PRICE_STARTER`, `STRIPE_PRICE_PRO`, `STRIPE_PRICE_AGENCY`, `MULTIPAGE_*_PRICE_ID`, `EXTRA_EDITS_PRICE_ID` |

## Phase 2 — Your job, once the human confirms `.env` is populated

### Step 1: Verify `.env`
Read `.env` (it should exist; if only `.env.example` exists, ask the human to copy and fill). Check that values are real, not placeholders. Run `npm run preflight` and report every ✗/✓. Do not proceed until Supabase, Anthropic, Vercel, GitHub, Resend all show ✓. Stripe + Sentry may remain skip.

### Step 2: Apply Supabase migrations
The 12 migrations are embedded at the bottom of this prompt. Preferred execution orders:

**Option A — psql (fastest)**: ask the human for the direct Postgres connection string (Supabase → Settings → Database → "URI"). Run:
```bash
export PGCONN="postgresql://postgres.xxxxx:password@...:5432/postgres"
for f in supabase/migrations/*.sql; do
  echo ">>> $f"
  psql "$PGCONN" -f "$f" -v ON_ERROR_STOP=1 || exit 1
done
```

**Option B — Supabase CLI**:
```bash
brew install supabase/tap/supabase
supabase link --project-ref <project-ref>  # the xxxxx part of the URL
supabase db push
```

**Option C — Manual via Supabase Studio**: open SQL Editor, paste each migration in numeric order, run, proceed. Only if A and B fail. Walk the user through this step by step; do not fake completion.

Verify each migration succeeded. If one fails partway, decide: is it idempotent-safe to rerun, or is the schema partially applied and needs manual reset? Report honestly.

### Step 3: Smoke test the auth flow end-to-end (local)
```bash
npm run dev   # :4321
```
Open a Puppeteer session (or ask the user to) and test:
1. `/sign-up` → fill email + password → submit → should create a Supabase auth user → redirect to `/dashboard`
2. Check the `users` table in Supabase: row should exist (auto-created by the `handle_new_user` trigger from migration 001).
3. `/dashboard/new` → start a new project → onboarding chat appears → send a message → verify the Anthropic call succeeds and a response comes back.
4. If onboarding completes, check that a `briefs` row exists and `conversations.messages` is populated.
5. Do not run full site generation yet (costs money and takes minutes) — just verify the flow up to brief readiness.

Report exactly where any failure occurs, with the error message and a hypothesis.

### Step 4: Git remote + push
Ask the user for the new GitHub repo URL (they will create it under the `grappes-sites` org or personal account). Then:
```bash
git remote add origin <url>
git branch -M main
git push -u origin main
```
Verify the push succeeded and the repo has all 4 commits.

### Step 5: Deploy to Vercel
```bash
npx vercel login     # if needed
npx vercel link      # link to a new project named "grappes" in the Grappes team
npx vercel env pull .env.production.local    # pull any existing env
```
Then either:
- **Option A**: push env vars via CLI:
  ```bash
  # for each .env line, run:
  vercel env add <KEY> production
  # paste the value when prompted
  ```
- **Option B** (preferred): tell the human to paste the whole `.env` into Vercel's project Settings → Environment Variables → "Import .env" in one shot.

Then:
```bash
npx vercel --prod
```
Capture the production URL. Verify with `curl` that the homepage responds 200.

### Step 6: Post-deploy verification
- `curl https://grappes.ai/` → 200
- `curl https://grappes.ai/api/health` → expect 200 healthy (because Supabase should now be reachable)
- Open `https://grappes.ai/` in a browser, scroll through landing, verify the boring-section animation runs, videos play, partner marquee scrolls
- Test sign-up on production
- Verify the first welcome email arrives via Resend

Report everything with clear ✓ / ✗ markers.

### Step 7: Optional post-launch polish
- Set up a Vercel cron for `/api/cron/expire-sites` if not auto-wired from `vercel.json`
- Hook up Stripe webhook endpoint in Stripe dashboard → `https://grappes.ai/api/webhooks/stripe`
- Wire custom domain grappes.ai if DNS isn't already pointing

## Ground rules
- Read real files before editing.
- `Edit` over `Write` for existing files.
- After any multi-file change: `npm run build` + `npx tsc --noEmit` before declaring done.
- Use `TaskCreate` / `TaskUpdate` when the work has 3+ distinct steps.
- Reply in Romanian, code + commits in English.
- No commits or pushes without explicit user request.
- If a Vercel plugin hook suggests Next.js / next/font / Auth.js / vercel-storage / workflow / chat-sdk — it's a false positive. Note briefly, skip.
- If you're unsure whether a change is safe, stop and ask. The project is in a tested clean state — do not regress it for speculative gains.

---

# 📜 SUPABASE MIGRATIONS (all 12, embedded)

Run these **in order**. They live in `supabase/migrations/` in the repo, but are inlined here so you can execute them via any channel (psql, Studio, SDK) without extra file reads.

## Migration 001 — `001_init.sql` (core schema)

```sql
-- ========================================
-- USERS (mirrors auth.users)
-- ========================================
CREATE TABLE users (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  name               TEXT,
  plan               TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'agency')),
  stripe_customer_id TEXT,
  projects_limit     INTEGER DEFAULT 1,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Auto-create user profile when a Supabase auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ========================================
-- PROJECTS (one per website)
-- ========================================
CREATE TABLE projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  status             TEXT DEFAULT 'onboarding' CHECK (status IN (
                       'onboarding', 'brief_ready', 'generating', 'generated',
                       'deploying', 'live', 'failed', 'archived'
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
-- GENERATED FILES
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
-- DEPLOYMENTS
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
-- ASSETS
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
-- COSTS
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
```

## Migration 002 — `002_edit_quotas.sql`

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS edits_used         INTEGER      NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS edits_period_start TIMESTAMPTZ  NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS extra_edits        INTEGER      NOT NULL DEFAULT 0;
```

## Migration 003 — `003_consume_edit_atomic.sql`

```sql
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
  SELECT plan, edits_used, edits_period_start, extra_edits
  INTO v_user
  FROM users
  WHERE id = p_user_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('allowed', false, 'error', 'user_not_found');
  END IF;

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

  IF date_trunc('month', v_now AT TIME ZONE 'UTC')
     > date_trunc('month', COALESCE(v_user.edits_period_start, v_now) AT TIME ZONE 'UTC')
  THEN
    v_edits_used := 0;
    UPDATE users SET edits_used = 0, edits_period_start = v_now WHERE id = p_user_id;
  END IF;

  IF v_edits_used >= v_monthly_limit AND v_extra_edits <= 0 THEN
    RETURN jsonb_build_object(
      'allowed', false, 'used', v_edits_used, 'limit', v_monthly_limit,
      'extra', v_extra_edits, 'remaining', 0, 'plan', v_user.plan
    );
  END IF;

  IF v_edits_used < v_monthly_limit THEN
    UPDATE users SET edits_used = edits_used + 1 WHERE id = p_user_id;
    v_edits_used := v_edits_used + 1;
  ELSE
    UPDATE users SET extra_edits = extra_edits - 1 WHERE id = p_user_id;
    v_extra_edits := v_extra_edits - 1;
  END IF;

  RETURN jsonb_build_object(
    'allowed', true, 'used', v_edits_used, 'limit', v_monthly_limit,
    'extra', v_extra_edits,
    'remaining', GREATEST(0, (v_monthly_limit + v_extra_edits) - v_edits_used),
    'plan', v_user.plan
  );
END;
$$;
```

## Migration 004 — `004_stripe_idempotency.sql`

```sql
CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id    text PRIMARY KEY,
  event_type  text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);
```

## Migration 005 — `005_referral_balance_atomic.sql`

```sql
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
```

## Migration 006 — `006_extra_edits_atomic.sql`

```sql
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
```

## Migration 007 — `007_create_pageviews.sql`

```sql
CREATE TABLE IF NOT EXISTS public.pageviews (
  id           BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id   UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  url          TEXT,
  referrer     TEXT,
  screen_width INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_pageviews_project_created
  ON public.pageviews (project_id, created_at DESC);

CREATE INDEX idx_pageviews_created
  ON public.pageviews (created_at DESC);

ALTER TABLE public.pageviews ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Service role can insert pageviews"
  ON public.pageviews FOR INSERT
  TO service_role
  WITH CHECK (true);

CREATE POLICY "Users can read own project pageviews"
  ON public.pageviews FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );
```

## Migration 008 — `008_referrals.sql`

```sql
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS referral_code         TEXT UNIQUE,
  ADD COLUMN IF NOT EXISTS referral_balance      DECIMAL(10,2) DEFAULT 0,
  ADD COLUMN IF NOT EXISTS referred_by           TEXT,
  ADD COLUMN IF NOT EXISTS last_edits_session_id TEXT;

CREATE TABLE IF NOT EXISTS referrals (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  referred_id    UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_used      TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'pending',
  plan_type      TEXT,
  amount_earned  DECIMAL(10,2) DEFAULT 0,
  created_at     TIMESTAMPTZ DEFAULT NOW(),
  confirmed_at   TIMESTAMPTZ,
  UNIQUE(referred_id)
);

CREATE TABLE IF NOT EXISTS referral_payouts (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  referrer_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount       DECIMAL(10,2) NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending',
  iban         TEXT,
  created_at   TIMESTAMPTZ DEFAULT NOW(),
  paid_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS referrals_referrer_id_idx        ON referrals(referrer_id);
CREATE INDEX IF NOT EXISTS referrals_referred_id_idx        ON referrals(referred_id);
CREATE INDEX IF NOT EXISTS referral_payouts_referrer_id_idx ON referral_payouts(referrer_id);
```

## Migration 009 — `009_refund_edits.sql`

```sql
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
```

## Migration 010 — `010_rate_limits.sql`

```sql
CREATE TABLE IF NOT EXISTS rate_limits (
  id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  key        text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_rate_limits_key_created ON rate_limits (key, created_at DESC);
```

## Migration 011 — `011_rename_commit_sha.sql`

```sql
ALTER TABLE deployments RENAME COLUMN commit_sha TO vercel_deploy_id;
```

## Migration 012 — `012_referral_signup_ip.sql`

```sql
ALTER TABLE referrals ADD COLUMN IF NOT EXISTS signup_ip text;
CREATE INDEX IF NOT EXISTS idx_referrals_signup_ip ON referrals (signup_ip, created_at DESC);
```

---

# 🧠 Full `.env` template

For reference — every variable the platform touches, with comments on where to get it. The human should populate this file at `astro-platform-ref/.env` (not commit it).

```bash
# ───── SUPABASE ─────
# Supabase dashboard → Settings → API
PUBLIC_SUPABASE_URL=https://<project-ref>.supabase.co
PUBLIC_SUPABASE_ANON_KEY=<anon-key>
SUPABASE_SERVICE_ROLE_KEY=<service-role-key>

# ───── VERCEL ─────
# vercel.com/account/tokens → create token "grappes-deploy"
# Team ID: vercel.com/teams/<team>/settings → General → ID
VERCEL_TOKEN=<vercel-api-token>
VERCEL_TEAM_ID=<team-id>
VERCEL_WEBHOOK_SECRET=<vercel-webhook-secret-from-dashboard>

# ───── GITHUB ─────
# github.com/settings/tokens (classic) with repo + admin:org + workflow scopes
GITHUB_TOKEN=<github-personal-access-token>
GITHUB_ORG=grappes-sites

# ───── AI ─────
# console.anthropic.com → Settings → API Keys
ANTHROPIC_API_KEY=<anthropic-api-key>

# ───── STRIPE (optional until real billing) ─────
STRIPE_SECRET_KEY=sk_live_<key>
STRIPE_WEBHOOK_SECRET=whsec_<key>
PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_<key>
EXTRA_EDITS_PRICE_ID=price_<extra-edits-pack>
STRIPE_PRICE_STARTER=price_<starter-monthly>
STRIPE_PRICE_PRO=price_<pro-annual>
STRIPE_PRICE_AGENCY=price_<agency-lifetime>
MULTIPAGE_MONTHLY_PRICE_ID=price_<multipage-monthly>
MULTIPAGE_YEARLY_PRICE_ID=price_<multipage-yearly>
MULTIPAGE_LIFETIME_PRICE_ID=price_<multipage-lifetime>

# ───── EMAIL ─────
# resend.com/api-keys
RESEND_API_KEY=re_<key>
RESEND_FROM_EMAIL=hello@grappes.ai
ADMIN_EMAIL=admin@grappes.ai

# ───── DOMAIN ─────
DOMAIN_MARKUP_EUR=5

# ───── ADMIN ─────
ADMIN_SECRET=<long-random-secret>

# ───── APP ─────
PUBLIC_APP_URL=http://localhost:4321
PUBLIC_SITE_URL=https://grappes.ai

# ───── PREVIEW SHARING ─────
SHARE_TOKEN_SECRET=<long-random-secret>

# ───── ERROR MONITORING (optional) ─────
SENTRY_DSN=https://<key>@<org>.ingest.sentry.io/<project>

# ───── CRON ─────
CRON_SECRET=<long-random-secret>
```

---

# ✅ Definition of done

You are done when all of the following are true:

1. `.env` has real values for at minimum the 9 critical vars (Supabase ×3, Anthropic, Vercel ×2, GitHub ×2, Resend)
2. `npm run preflight` shows ✓ for Supabase, Anthropic, Vercel, GitHub, Resend
3. All 12 Supabase migrations applied, verified by listing tables (`users`, `projects`, `briefs`, `conversations`, `generated_files`, `deployments`, `assets`, `costs`, `stripe_processed_events`, `pageviews`, `referrals`, `referral_payouts`, `rate_limits`)
4. Sign-up works locally, a row appears in `users`, and a new project can be created
5. Onboarding chat sends one Anthropic message and gets a response
6. Git remote added, 4 commits pushed to the new repo
7. Vercel deployment succeeds, returns a production URL
8. `https://grappes.ai/` or the Vercel-assigned URL returns 200 and the landing renders correctly in a real browser
9. Welcome email arrives when you sign up on production

Report your progress after each step with the command output. If a step fails, stop and debug it — do not push forward pretending it worked.

# 📋 COPY-PASTE ENDS HERE
