# Neon + Better-Auth Cutover

This branch replaces Supabase (Auth + Postgres + Storage + Realtime) with:
- **Better-Auth** for sessions, email+password, Google OAuth, password reset
- **Neon Postgres** for the database (raw `postgres-js` client + Drizzle for the auth schema)
- **Vercel Blob** for file storage
- **Polling** instead of Realtime for the deploy-status UI

A compatibility shim in `src/lib/supabase.ts` lets the existing 60+ code paths keep using `.from(...)`, `.rpc(...)`, `.storage.from(...)` unchanged — they all now hit Neon / Blob underneath.

---

## 1. Provision Neon on Vercel

1. Vercel Dashboard → grappes-app project → **Storage** tab → **Create Database** → **Neon Serverless Postgres**
2. Region: pick close to your audience (e.g. `eu-central-1`)
3. After creation, Vercel auto-injects `DATABASE_URL` into Production + Preview envs. Verify in Settings → Environment Variables.

## 2. Set required env vars on Vercel

| Variable | Where to get it | Notes |
|---|---|---|
| `DATABASE_URL` | Auto-set by Neon Vercel integration | Production + Preview |
| `BETTER_AUTH_SECRET` | `openssl rand -base64 32` | Production + Preview |
| `BETTER_AUTH_URL` | `https://grappes.dev` | Production only (Preview omits → falls back to request URL) |
| `GOOGLE_CLIENT_ID` | console.cloud.google.com → OAuth 2.0 Client ID | New Web client, see step 3 |
| `GOOGLE_CLIENT_SECRET` | Same place as above | Production + Preview |
| `BLOB_READ_WRITE_TOKEN` | Vercel → Storage → create Blob store | Auto-injected if you use the integration |
| Existing: `ANTHROPIC_API_KEY`, `STRIPE_*`, `RESEND_API_KEY`, `VERCEL_TOKEN`, `GITHUB_TOKEN`, `PSI_API_KEY`, etc. | Already configured | Carry over unchanged |

**Env vars to REMOVE** (no longer used):
- `PUBLIC_SUPABASE_URL`
- `PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

(Leave them in place during cutover so you can roll back; remove after the new deploy is stable.)

## 3. Google OAuth client (for sign-in with Google)

1. console.cloud.google.com → APIs & Services → Credentials → **Create OAuth client ID**
2. Application type: Web application
3. **Authorized redirect URIs**: `https://grappes.dev/api/auth/callback/google` and `http://localhost:4321/api/auth/callback/google` (for dev)
4. Copy Client ID + Client Secret into the Vercel env vars above

## 4. Run the schema migration on Neon

The migration generator already concatenated all 26 Supabase migration files (001 → 026) into a single Neon-ready script with RLS / auth.users / handle_new_user / GRANT lines stripped.

```bash
# Local dev: connect via DATABASE_URL pulled from Vercel
vercel env pull .env.local
npm run db:migrate
```

This applies:
- `src/db/migrations/0000_better_auth_init.sql` (user / session / account / verification tables)
- `src/db/migrations/0001_grappes_init.sql` (everything else: projects, briefs, conversations, generated_files, edits, referrals, pageviews, contact_submissions, support_chat, project_integrations, assets, project_iterations, **reel_credits + reel_analyses_index**, **audit_credits + seo_audits**, etc.)

The script tracks applied migrations in a `_migrations` table — safe to re-run.

## 5. (Optional) Migrate data from Supabase to Neon

**Skip this if you're OK starting fresh and asking users to re-register.** Otherwise:

```bash
# Dump Supabase user-data tables (NOT auth.users — those go through Better-Auth's signup flow with password reset emails)
pg_dump "$SUPABASE_DB_URL" \
  --table=public.users --table=public.projects --table=public.briefs --table=public.conversations \
  --table=public.generated_files --table=public.referrals --table=public.contact_submissions \
  --data-only --column-inserts > supabase-data.sql

# Restore into Neon (will hit FK constraint on user_id if those users don't exist yet)
psql "$DATABASE_URL" < supabase-data.sql
```

**Tricky:** in Supabase, `users.id` references `auth.users.id`. In Neon, it references Better-Auth's `"user".id`. The IDs won't match unless you also import an equivalent row into Better-Auth's user table for each existing user — typically by triggering a password-reset email so they set a new password and a new Better-Auth row is created with the SAME email, then you UPDATE `public.users.id` to point at the new Better-Auth UUID. Complex. **Easier path: announce a re-registration window to existing users.**

## 6. Deploy

```bash
git push origin migration/vercel-stack
gh pr create --base main --title "Migrate to Neon + Better-Auth + Vercel Blob"
# Merge → Vercel auto-deploys
```

## 7. Smoke test on production after deploy

- [ ] grappes.dev/sign-up → create a new account → land on /dashboard
- [ ] grappes.dev/sign-in → sign-in with that account → /dashboard
- [ ] Continue with Google → returns to /dashboard signed-in
- [ ] /dashboard/new → create a project → upload a logo → generate
- [ ] /dashboard/reels → buy credits flow opens Stripe Checkout
- [ ] /audit → run an audit on a public URL → report renders
- [ ] /reset-password → email arrives via Resend → reset works
- [ ] Sign out → cookie cleared
- [ ] Stripe webhook → manual test purchase → credits show up

## 8. After it's stable

- Remove `PUBLIC_SUPABASE_*` and `SUPABASE_SERVICE_ROLE_KEY` from Vercel env
- Cancel the Supabase project subscription (after 30+ days as a safety window in case of rollback)
- Remove `@supabase/ssr` and `@supabase/supabase-js` from `package.json` (the shim re-exports types from these for now — would need a small refactor to drop entirely)

---

## Rollback

If something breaks on prod:
- Vercel → Deployments → previous main deploy → **Promote to Production**
- Supabase env vars are still set → old code reconnects to Supabase as before
- No data loss because data migration (step 5) is opt-in
