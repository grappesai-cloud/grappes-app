# Grappes — Claude Code Handoff Prompt

Paste the block below into a **new Claude Code session** started from the project root
(`/Users/alexandrucojanu/Desktop/astro-platform-ref`) when you want to resume work.

Tailor the last section ("What I want you to do now") to whatever phase you're in.

---

## 📋 Copy-paste prompt starts here

You are continuing work on **Grappes** — an AI website generator SaaS built on Astro + Supabase + Anthropic, deployed on Vercel. The project lives at `/Users/alexandrucojanu/Desktop/astro-platform-ref`. **Read this entire brief before doing anything.**

### Project identity
- **Brand**: Grappes (logo is purple gradient G, accent color `#9BD4D7`, dark theme `#0a0a0a`, Inter font everywhere).
- **Domain**: grappes.ai
- **Support email**: hello@grappes.ai · transactional from start@grappes.ai
- **Target user**: anyone who wants a unique, award-grade website in under 90 seconds without templates. Positioned with the tagline *"Don't be boring."*
- **Owner**: Alexandru Cojanu — Romanian speaker, founder.

### What this codebase is
A full-stack Astro SSR app (NOT a static site, NOT Next.js). Uses:
- `astro` v5 + `@astrojs/vercel` v8 adapter (Node 22 runtime on Vercel)
- `@supabase/ssr` for auth + Postgres DB
- `@anthropic-ai/sdk` + optional Gemini for AI generation
- `stripe` for billing
- `resend` for transactional email
- GitHub + Vercel APIs for deploying generated user sites
- React islands for interactive chunks (`OnboardingChat`, `BriefEditor`, `DeployStatus`)
- GSAP + Lenis for scroll animations (used in the landing `boring-section`)

**Do not** suggest migrating to Next.js or swapping frameworks. Astro is the intentional choice.

### Routes inventory
- `/` — ported Webflow landing, Grappes-branded, animated "Boring is expensive" section
- `/sign-in` `/sign-up` `/forgot-password` `/reset-password` — Supabase auth, EN-only
- `/terms` `/privacy` — legal, EN-only
- `/404` `/500` — error pages
- `/sitemap.xml` `/robots.txt` — SEO
- `/api/health` — health check (returns 200 healthy / 503 degraded)
- `/dashboard/*` — 12 protected pages (index, new, account, referrals, [id]/index, brief, edit, preview, deploy, settings, onboarding, manual-brief)
- `/admin` — admin panel
- `/api/*` — 55 serverless functions (auth, onboarding, projects, deploy, billing, domains, qa, webhooks, cron, analytics, forms, referral, admin)

### What's already done (as of the previous session)

**Landing**: Webflow HTML ported to `src/pages/index.astro` with `is:global` styles and `is:inline` scripts. All Webflow CSS + used JS bundles live in `public/assets/grappes/`. Assets (logo.png, hero-bg.mp4, hwa-video.mp4, char-waving.png, char-shrug.png, bracket-left.png, bracket-right.png, click-connected.png, partner logos) are all in `public/assets/grappes/`. OG image 1200×630 exists at `/assets/grappes/og-image.png`.

**Rebrand**: Every `WebNow`, `webnow.dev`, `milestoners`, Dutch, and Romanian string has been replaced across `src/pages`, `src/components`, `src/lib`, `src/layouts`. Tests, scripts, email templates in `src/lib/resend.ts` — all EN-only.

**CTAs**: "Start today" / "Start Building Free" → `/sign-up`. "Contact us" / "Work with our directors" → `mailto:hello@grappes.ai`. Nav anchors `#features` `#platform` `#how-it-works` `#pricing` `#agencies` `#contact` all resolve.

**Middleware (`src/middleware.ts`)**: has a graceful bypass — public paths (`/`, `/sign-in`, `/sign-up`, `/terms`, `/privacy`, `/sitemap.xml`, `/robots.txt`, `/api/health`, etc.) render even when Supabase env vars are placeholder. Protected routes return a clean 503 JSON diagnostic. Real Supabase config activates full auth flow.

**Env helper (`src/lib/env.ts`)**: `validateEnv()` logs boot-time warnings for missing critical vars without throwing.

**Preflight (`scripts/preflight.mjs` → `npm run preflight`)**: verifies Supabase / Anthropic / Vercel / GitHub / Resend connectivity before deploy. Run this before every `vercel --prod`.

**Visual regression (`scripts/smoke-screens.mjs`)**: Puppeteer screenshots of all public routes. Catches layout regressions.

**Git**: fresh repo (not the upstream astro-platform). 4 commits on `main`. No secrets committed. `.env` is gitignored. Ready to `git remote add origin <new-repo-url>` and push.

**Tests**: 45/45 passing via `vitest`. TypeScript `tsc --noEmit` clean.

**Build**: `npm run build` complete, `.vercel/output/` ready for `vercel --prod`.

**Placeholder `.env`** exists with non-empty dummy values so `npm run dev` serves the landing and auth pages without crashing. Real credentials replace these when you're ready.

### Required accounts to deploy for real
You (or Alexandru) need to create brand-new Grappes-dedicated accounts and paste their secrets into `.env`:
1. **Supabase** → `PUBLIC_SUPABASE_URL`, `PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`
2. **Anthropic** → `ANTHROPIC_API_KEY`
3. **Vercel** → `VERCEL_TOKEN`, `VERCEL_TEAM_ID`
4. **GitHub** → `GITHUB_TOKEN`, `GITHUB_ORG` (org hosts generated user sites)
5. **Resend** → `RESEND_API_KEY` (plus verify the grappes.ai domain DNS)
6. Optional: Gemini (image gen), Stripe (real billing), Sentry (error tracking)

The full step-by-step walkthrough lives in `SETUP-GRAPPES.md` in the repo root. `.env.example` documents every variable.

### Key commands
```bash
npm run dev             # http://localhost:4321 — hot reload
npm run build           # full Vercel bundle in .vercel/output/
npm run preflight       # verify env + API connectivity
npx vitest run          # run all tests
npx tsc --noEmit        # TypeScript strict check
node scripts/smoke-screens.mjs   # Puppeteer visual regression
```

### Gotchas — do not repeat my mistakes
- **Puppeteer `waitUntil: 'networkidle0'`** times out because GA beacons hold connections open. Use `'domcontentloaded'` + a short `setTimeout` instead.
- **Astro `<style>` blocks default to SCOPED CSS**, which breaks Webflow class names. The landing uses `<style is:global>` — keep it that way. `<script>` blocks likewise need `is:inline` to preserve the Webflow init timing and GSAP/Lenis setup.
- **The landing's `#service-trigger` dropdown script** is guarded with an early-return because we removed the trigger element. Don't unguard it.
- **Pricing/Creative Direction CTAs** used to point to Google Calendar URLs. They're now `/sign-up` and `mailto:hello@grappes.ai`. Don't revert.
- **The `boring-section`** is height:450vh with `position:sticky` pin + GSAP ScrollTrigger `scrub`. It has 5 scenes. The character swaps between `char-waving.png` and `char-shrug.png` at scene 3. Brackets fly in from the sides at scene 4. Background flips from `#0a0a0a` to `#f5f5f5` at scene 5.
- **Sentry SDK options** live in `sentry.client.config.js` + `sentry.server.config.js`. Do NOT pass them back inline into `astro.config.mjs` (deprecated in @sentry/astro v10+).
- **`@supabase/supabase-js`** is in `vite.optimizeDeps.include` because `reset-password.astro` imports it client-side and Vite dev would otherwise warm-start a failed request.
- **Vercel hook suggestions about `next/font`, `Next.js App Router`, `Vercel Routing Middleware`** are false positives from basename matching — this is Astro, not Next.js. Acknowledge and ignore them, but do not apply Next.js-specific advice.
- **When debugging runtime errors**, the platform has real Supabase/Stripe/Anthropic failures only when real credentials are loaded. Before blaming code, run `npm run preflight` to rule out config issues.

### How I want you to work
- Read real files before editing (never guess contents from memory).
- Prefer `Edit` over `Write` for existing files.
- After any multi-file edit run `npm run build` and `npx tsc --noEmit` before declaring done.
- When making UI changes, verify visually: `node scripts/smoke-screens.mjs` or a one-off Puppeteer script checking `pageerror` + failed requests.
- Use `TaskCreate` / `TaskUpdate` when the work has 3+ distinct steps so I can see progress.
- Answer me in Romanian. Code and commit messages stay in English.
- Never commit without being asked.
- Never push to remote without being asked.
- If Vercel/Next.js hook suggestions fire, note them briefly and proceed — don't stop to "load docs" for libraries I'm not using.
- If you're not sure a change is safe, stop and ask before doing it. The project is already in a clean, tested state; don't regress it for speculative improvements.

### What I want you to do now
**[REPLACE THIS SECTION each time you paste the prompt. Pick one of the modes below, or write your own.]**

**Mode A — Real credentials setup:** I have the real Supabase / Anthropic / Vercel / GitHub / Resend keys ready. Walk me through pasting them into `.env`, running the migrations against the fresh Supabase project, running `npm run preflight`, and smoke-testing sign-up → onboarding → one generation end-to-end. Report problems clearly.

**Mode B — Deploy:** `.env` is already filled and preflight passes. Deploy to Vercel production, wire env vars in the Vercel dashboard, and verify the live domain serves the same content as local. Then smoke-test the live deployment.

**Mode C — Runtime debugging:** Something is broken. I will paste logs / error / symptom. Reproduce locally when possible, root-cause it, fix it, verify with the appropriate test, report.

**Mode D — Feature work:** I want to change X on the landing / auth / dashboard / onboarding flow. Do it carefully, don't regress other areas, verify with smoke screens.

**Mode E — Open-ended audit:** Run an audit over {area}. Report findings with severity and a proposed fix before touching anything.

---

## 📋 End of prompt
