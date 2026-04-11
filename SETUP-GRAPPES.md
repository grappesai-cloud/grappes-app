# Grappes — Setup Guide

This Astro project is the full Grappes platform:
- **Landing page** (`/`) — the ported Webflow landing with hero video, animated "Boring is expensive" section, pricing, and white-label CTA
- **Auth** (`/sign-in`, `/sign-up`, `/forgot-password`, `/reset-password`) — Supabase SSR
- **Dashboard** (`/dashboard`, `/dashboard/[id]/onboarding`, `/brief`, `/preview`, `/edit`, `/deploy`, `/settings`) — user project management
- **AI generation pipeline** — Anthropic + Gemini for copy, layout, and design
- **Vercel deploy integration** — generated sites deploy to Vercel via API
- **GitHub integration** — generated sites live in a GitHub org
- **Billing** — Stripe checkout + subscriptions
- **Admin panel** (`/admin`) — analytics, referrals, activations
- **Legal pages** (`/terms`, `/privacy`)

## 1. Create brand-new accounts for Grappes

You decided to create dedicated Grappes accounts on every service. Do them in this order:

### a) Supabase
1. Go to https://supabase.com/dashboard
2. Create a new organization **"Grappes"**
3. Create a new project **"grappes-prod"** (pick a region close to your users, e.g., `eu-central-1`)
4. Wait for the project to provision (~2 min)
5. From **Settings → API**, copy:
   - `Project URL` → `PUBLIC_SUPABASE_URL`
   - `anon public` → `PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` → `SUPABASE_SERVICE_ROLE_KEY`

### b) Run DB migrations
Migrations live in `supabase/migrations/*.sql`. Apply them:

**Option 1 — Via Supabase Studio (easiest):**
- Open your project in the Supabase dashboard
- Go to **SQL Editor → New query**
- Paste each migration file in order (`001_init.sql` → `010_rate_limits.sql`)
- Run each

**Option 2 — Via Supabase CLI:**
```bash
brew install supabase/tap/supabase
supabase link --project-ref YOUR_PROJECT_REF
supabase db push
```

### c) Anthropic
1. Go to https://console.anthropic.com
2. Create an account under **hello@grappes.ai**
3. Add a payment method (AI generation needs credit)
4. **Settings → API Keys** → Create Key → name it "grappes-prod"
5. Copy key → `ANTHROPIC_API_KEY`

### d) Google Gemini (optional — used for image generation)
1. Go to https://aistudio.google.com/app/apikey
2. Create API key
3. Copy → `GEMINI_API_KEY`

### e) Vercel
1. Sign up at https://vercel.com with `hello@grappes.ai`
2. Create a new team **"Grappes"**
3. **Account Settings → Tokens** → Create Token → name it "grappes-deploy", scope: "Full Account"
4. Copy → `VERCEL_TOKEN`
5. From **Team Settings → General**, copy the **Team ID** → `VERCEL_TEAM_ID`

### f) GitHub
1. Sign up at https://github.com (new account) or use existing
2. Create a new organization **"grappes-sites"** (this hosts generated user sites)
3. Create a Personal Access Token at https://github.com/settings/tokens (classic)
   - Scopes needed: `repo`, `admin:org`, `workflow`
4. Copy → `GITHUB_TOKEN`
5. Set `GITHUB_ORG=grappes-sites`

### g) Resend (transactional email)
1. Sign up at https://resend.com with `hello@grappes.ai`
2. Add domain `grappes.ai` and verify DNS (SPF, DKIM, MX records)
3. Create API key → `RESEND_API_KEY`
4. Set `RESEND_FROM_EMAIL=hello@grappes.ai`

### h) Stripe (optional — only when you want real payments)
1. Sign up at https://stripe.com with `hello@grappes.ai`
2. Activate the account
3. **Developers → API Keys** → copy secret + publishable → `STRIPE_SECRET_KEY`, `PUBLIC_STRIPE_PUBLISHABLE_KEY`
4. Create products in Stripe Dashboard matching the pricing in `src/react/i18n/en.json`:
   - Starter monthly (€15) → `STRIPE_PRICE_STARTER`
   - Pro annual (€100) → `STRIPE_PRICE_PRO`
   - Agency lifetime (€350) → `STRIPE_PRICE_AGENCY`
   - Multi-page variants → `MULTIPAGE_MONTHLY_PRICE_ID`, etc.
5. Set up a webhook at `https://grappes.ai/api/webhooks/stripe` with events: `checkout.session.completed`, `customer.subscription.*`, `invoice.*` → copy signing secret → `STRIPE_WEBHOOK_SECRET`

## 2. Local setup

```bash
cd astro-platform-ref
cp .env.example .env
# Fill .env with values from step 1
nvm use 22          # Vercel requires Node 22 for SSR
npm install
npm run dev
```

Visit http://localhost:4321 — you should see the Grappes landing.

## 3. Deploy to Vercel

```bash
# From the project root
npx vercel --prod
```
Then add all `.env` variables to **Vercel Project → Settings → Environment Variables**.

Or connect the GitHub repo in Vercel dashboard for auto-deploy on push.

## 4. What was ported

The landing page at `/` was ported from the Webflow static export `www.grappes.ai/` that lives alongside this project. All assets (logo, hero video, character illustrations, partner logos, brackets, click visual) are in `public/assets/grappes/`.

The source HTML, CSS (`grappes.webflow.css`), and Webflow JS bundles were copied and path-rewritten. Inline `<style>` blocks are tagged `is:global` (to prevent Astro's CSS scoping from breaking Webflow class names) and inline `<script>` blocks are tagged `is:inline` (to preserve timing-sensitive Webflow init code and GSAP animations).

CTA buttons that previously linked to `mailto:start@grappes.ai` now route to `/sign-up`. Legal links `terms.html` / `privacy.html` route to `/terms` / `/privacy` (rewritten in `src/pages/terms.astro` / `src/pages/privacy.astro`).

## 5. What still uses the old WebNow brand

Everything text-level has been rebranded to **Grappes** (code, i18n, emails, UI strings). Check-in sweeps:
```bash
grep -ri "webnow" src/ public/
```
Should return zero hits (besides possibly generated `.astro/` cache).

The old HomePageWrapper React component (`src/react/HomePageWrapper.tsx`) and all the old WebNow landing React components under `src/react/main-component/HomePage/` and `src/react/components/` are **orphaned** — no longer referenced by `/`. You can keep them (they don't hurt build time much) or delete them to slim the repo. The rebuilt `/` is now a pure Astro page with the Grappes Webflow markup.

## 6. Next steps (optional cleanup)

- Delete orphaned React components: `src/react/components/`, `src/react/main-component/HomePage/`, `src/react/HomePageWrapper.tsx`
- Remove unused npm deps (`bootstrap`, `swiper`, `react-slick`, `slick-carousel`, `animate.css`, `react-player`, `react-fast-marquee`, `motion`, `ogl`, `react-anchor-link-smooth-scroll`) — they're only used by the old WebNow React components
- Replace the `favicon.png` with an `.ico` for wider browser compat (optional)
- Wire the `Start today` CTA and the `Get Started` header CTA into onboarding with a pre-filled source-attribution query param, e.g., `/sign-up?utm_source=landing_hero`
