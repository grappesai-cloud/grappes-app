// ─── Provision user accounts (CLI) ───────────────────────────────────────────
// Creates Better-Auth email/password accounts the CORRECT way (auth.api.signUpEmail
// → proper scrypt hashing, auth tables, fires the public.users mirror hook +
// welcome email), generates a strong password for each, and optionally grants
// per-service credits in the same run. You run this — it writes to the live DB.
//
// The created users log in with their email + the printed password (or use
// "forgot password" to set their own). This does NOT wire Google sign-in to the
// account — that needs account-linking in auth.ts (ask before changing auth).
//
// USAGE:
//   npx tsx scripts/create-user.mts <email> [more emails...] [--name "Full Name"] [--credits audit:10,reel:5]
//
//   --credits   kind:amount pairs, comma-separated. Applied to every email.
//               kinds: reel | audit | soc2 | logo | offer | brandbook | social | site
//
//   e.g.  npx tsx scripts/create-user.mts szaspatrick50@gmail.com --credits audit:10
//         npx tsx scripts/create-user.mts a@x.com b@y.com --credits reel:5,site:3
//
// Reads env from ./.env (BETTER_AUTH_SECRET, DATABASE_URL, SUPABASE_* etc.).

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import crypto from 'node:crypto';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// Load .env into process.env BEFORE importing auth (auth.ts reads env at module load).
try {
  const txt = await readFile(path.join(REPO, '.env'), 'utf8');
  for (const line of txt.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
} catch { /* no .env — rely on real env */ }

// ── args ──────────────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
let creditsArg = '';
let nameArg = '';
const emails: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--credits') creditsArg = argv[++i] || '';
  else if (argv[i] === '--name') nameArg = argv[++i] || '';
  else emails.push(argv[i]);
}
if (emails.length === 0) {
  console.error('Usage: npx tsx scripts/create-user.mts <email> [more...] [--name "Full Name"] [--credits audit:10,reel:5]');
  process.exit(1);
}

const CREDIT_COLUMN: Record<string, string> = {
  reel: 'reel_credits', audit: 'audit_credits', soc2: 'soc2_credits', logo: 'logo_credits',
  offer: 'offer_credits', brandbook: 'brandbook_credits', social: 'social_credits', site: 'site_credits',
};
const grants = creditsArg
  ? creditsArg.split(',').map((p) => { const [k, a] = p.split(':'); return { kind: (k || '').trim(), amount: Number(a) }; })
  : [];
for (const g of grants) {
  if (!(g.kind in CREDIT_COLUMN) || !Number.isFinite(g.amount) || g.amount === 0) {
    console.error(`Bad --credits entry "${g.kind}:${g.amount}". kinds: ${Object.keys(CREDIT_COLUMN).join(', ')}`);
    process.exit(1);
  }
}

function genPassword(): string {
  // 16 url-safe chars + guaranteed symbol/upper/digit to satisfy any policy
  const base = crypto.randomBytes(16).toString('base64').replace(/[+/=]/g, '').slice(0, 16);
  return base + 'A7!';
}

// ── run ───────────────────────────────────────────────────────────────────
const { auth } = await import('../src/lib/auth');
const { grantCredit } = await import('../src/lib/credits');

let ok = 0, failed = 0;
for (const email of emails) {
  const name = nameArg || email.split('@')[0];
  const password = genPassword();
  try {
    const res: any = await auth.api.signUpEmail({ body: { email, password, name } });
    const userId = res?.user?.id ?? res?.id;
    console.log(`\n✓ ${email}`);
    console.log(`   password: ${password}`);
    console.log(`   userId:   ${userId ?? '(unknown — check DB)'}`);
    if (userId) {
      for (const g of grants) {
        try {
          const bal = await grantCredit(userId, g.kind as any, g.amount);
          console.log(`   +${g.amount} ${g.kind} -> ${bal}`);
        } catch (e: any) {
          console.warn(`   ! credit ${g.kind} failed: ${e?.message || e}`);
        }
      }
    }
    ok++;
  } catch (e: any) {
    console.error(`\n✗ ${email}: ${e?.body?.message || e?.message || String(e)}`);
    failed++;
  }
}

console.log(`\n${'─'.repeat(50)}\nDone: ${ok} created, ${failed} failed.`);
process.exit(failed && !ok ? 1 : 0);
