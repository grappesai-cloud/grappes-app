#!/usr/bin/env node
// ─── White-label credit grant (CLI) ──────────────────────────────────────────
// Grant or deduct per-service credits for a grappes user, by email. Mirrors
// POST /api/admin/users/[id]/grant-credits (kind whitelist + clamp at 0), but as
// a terminal tool you run yourself — useful while the admin panel has no
// per-service credit control.
//
// USAGE:
//   node scripts/grant-credits.mjs <email>                  # show all balances
//   node scripts/grant-credits.mjs <email> <kind> <amount>  # grant (negative = deduct)
//
//   kind: reel | audit | soc2 | logo | offer | brandbook | social | site
//   e.g.  node scripts/grant-credits.mjs szaspatrick50@gmail.com audit 10
//
// Reads DATABASE_URL from process.env or ./.env. This writes to the live DB —
// double-check the email and amount before running.

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, '..');

// Mirrors CREDIT_COLUMN in src/lib/credits.ts — keep in sync.
const CREDIT_COLUMN = {
  reel: 'reel_credits',
  audit: 'audit_credits',
  soc2: 'soc2_credits',
  logo: 'logo_credits',
  offer: 'offer_credits',
  brandbook: 'brandbook_credits',
  social: 'social_credits',
  site: 'site_credits',
};

const [, , email, kind, amountRaw] = process.argv;
if (!email) {
  console.error('Usage:');
  console.error('  node scripts/grant-credits.mjs <email>                  # show balances');
  console.error('  node scripts/grant-credits.mjs <email> <kind> <amount>  # grant / deduct');
  console.error('  kinds: ' + Object.keys(CREDIT_COLUMN).join(', '));
  process.exit(1);
}

async function readEnvVar(key) {
  if (process.env[key]) return process.env[key];
  try {
    const txt = await readFile(path.join(REPO, '.env'), 'utf8');
    const m = txt.match(new RegExp('^' + key + '=(.*)$', 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch { /* no .env */ }
  return '';
}

const url = await readEnvVar('DATABASE_URL');
if (!url) { console.error('DATABASE_URL not found (env or ./.env)'); process.exit(1); }

const { default: postgres } = await import('postgres');
const sql = postgres(url, { ssl: 'require', max: 1 });
try {
  const users = await sql`select * from users where lower(email) = lower(${email}) limit 2`;
  if (users.length === 0) { console.error(`No user with email ${email}`); process.exit(1); }
  if (users.length > 1) { console.error(`Multiple users match ${email} — aborting`); process.exit(1); }
  const u = users[0];

  // No kind → just print balances (read-only).
  if (!kind) {
    console.log(`Credits for ${u.email} (${u.id}):`);
    for (const [k, col] of Object.entries(CREDIT_COLUMN)) {
      console.log(`  ${k.padEnd(10)} ${col in u ? (u[col] ?? 0) : '(column missing — migration 0029?)'}`);
    }
    process.exit(0);
  }

  if (!(kind in CREDIT_COLUMN)) {
    console.error(`Unknown kind "${kind}". Valid: ${Object.keys(CREDIT_COLUMN).join(', ')}`);
    process.exit(1);
  }
  const col = CREDIT_COLUMN[kind];
  if (!(col in u)) {
    console.error(`Column ${col} does not exist on this DB — migration 0029 (universal_credits) may not be applied.`);
    process.exit(1);
  }
  const amount = Number(amountRaw);
  if (!Number.isFinite(amount) || amount === 0 || amount < -999_999 || amount > 999_999) {
    console.error('amount must be a non-zero number within ±999999');
    process.exit(1);
  }

  const current = Number(u[col] ?? 0);
  const target = Math.max(0, current + amount); // clamp at 0, same as the admin endpoint
  await sql`update users set ${sql(col)} = ${target} where id = ${u.id}`;
  console.log(`${u.email}: ${kind} ${current} -> ${target}  (${amount >= 0 ? '+' : ''}${amount})`);
} finally {
  await sql.end({ timeout: 5 });
}
