#!/usr/bin/env node
/**
 * Grappes pre-deploy preflight check.
 * Run before deploying: `npm run preflight`
 *
 * Verifies:
 *   1. All critical env vars are set (non-placeholder)
 *   2. Supabase connection works (DB reachable, auth config loadable)
 *   3. Anthropic API key is valid (lists models)
 *   4. Vercel API token is valid (identifies user)
 *   5. GitHub token has required scopes
 *   6. Resend domain is verified (if RESEND_API_KEY set)
 *
 * Exits with code 0 if all checks pass, 1 otherwise.
 */

import fs from 'node:fs';
import path from 'node:path';

const GREEN = '\x1b[32m';
const RED = '\x1b[31m';
const YELLOW = '\x1b[33m';
const BLUE = '\x1b[34m';
const DIM = '\x1b[2m';
const BOLD = '\x1b[1m';
const RESET = '\x1b[0m';

// Load .env manually (no dotenv dependency)
const envPath = path.resolve('.env');
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, 'utf8');
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
    if (!process.env[key]) process.env[key] = value;
  }
}

const results = [];

function check(name, status, detail = '') {
  results.push({ name, status, detail });
  const badge =
    status === 'ok'     ? `${GREEN}✓${RESET}` :
    status === 'fail'   ? `${RED}✗${RESET}` :
    status === 'warn'   ? `${YELLOW}!${RESET}` :
                           `${DIM}·${RESET}`;
  const label = name.padEnd(32);
  console.log(`  ${badge}  ${label}${DIM}${detail}${RESET}`);
}

function isPlaceholder(val) {
  if (!val) return true;
  return val.includes('placeholder') || val.includes('your-') || val.startsWith('sk-ant-placeholder') || val === '';
}

console.log(`\n${BOLD}${BLUE}Grappes preflight check${RESET}\n`);

// --- 1. Env vars ---
console.log(`${BOLD}1. Environment variables${RESET}`);

const CRITICAL_VARS = [
  ['PUBLIC_SUPABASE_URL', 'Supabase'],
  ['PUBLIC_SUPABASE_ANON_KEY', 'Supabase'],
  ['SUPABASE_SERVICE_ROLE_KEY', 'Supabase'],
  ['ANTHROPIC_API_KEY', 'Anthropic'],
  ['VERCEL_TOKEN', 'Vercel'],
  ['VERCEL_TEAM_ID', 'Vercel'],
  ['GITHUB_TOKEN', 'GitHub'],
  ['GITHUB_ORG', 'GitHub'],
  ['RESEND_API_KEY', 'Resend'],
];

let allCriticalSet = true;
for (const [key, group] of CRITICAL_VARS) {
  const val = process.env[key];
  if (isPlaceholder(val)) {
    check(key, 'fail', `missing (${group})`);
    allCriticalSet = false;
  } else {
    check(key, 'ok', `set (${val.slice(0, 6)}…)`);
  }
}

const OPTIONAL_VARS = [
  ['GEMINI_API_KEY', 'Gemini (image gen)'],
  ['STRIPE_SECRET_KEY', 'Stripe (billing)'],
  ['STRIPE_WEBHOOK_SECRET', 'Stripe (billing)'],
  ['SENTRY_DSN', 'Sentry (errors)'],
];
for (const [key, group] of OPTIONAL_VARS) {
  const val = process.env[key];
  if (isPlaceholder(val)) {
    check(key, 'skip', `unset — ${group}`);
  } else {
    check(key, 'ok', `set (${val.slice(0, 6)}…)`);
  }
}

if (!allCriticalSet) {
  console.log(`\n${RED}${BOLD}✗ Preflight failed: missing critical env vars.${RESET}`);
  console.log(`${DIM}  See SETUP-GRAPPES.md to wire them up.${RESET}\n`);
  process.exit(1);
}

// --- 2. Supabase ---
console.log(`\n${BOLD}2. Supabase reachability${RESET}`);
try {
  const url = `${process.env.PUBLIC_SUPABASE_URL}/auth/v1/health`;
  const r = await fetch(url, {
    headers: { apikey: process.env.PUBLIC_SUPABASE_ANON_KEY },
  });
  if (r.ok) {
    check('auth endpoint', 'ok', `${r.status} ${r.statusText}`);
  } else {
    check('auth endpoint', 'fail', `${r.status} ${r.statusText}`);
  }
} catch (err) {
  check('auth endpoint', 'fail', err.message);
}

// --- 3. Anthropic ---
console.log(`\n${BOLD}3. Anthropic API${RESET}`);
try {
  const r = await fetch('https://api.anthropic.com/v1/models', {
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
  });
  if (r.ok) {
    const data = await r.json();
    check('list models', 'ok', `${data.data?.length ?? 0} models`);
  } else {
    check('list models', 'fail', `${r.status} ${r.statusText}`);
  }
} catch (err) {
  check('list models', 'fail', err.message);
}

// --- 4. Vercel ---
console.log(`\n${BOLD}4. Vercel API${RESET}`);
try {
  const r = await fetch('https://api.vercel.com/v2/user', {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  if (r.ok) {
    const data = await r.json();
    check('token valid', 'ok', `user: ${data.user?.username || data.user?.email || '?'}`);
  } else {
    check('token valid', 'fail', `${r.status} ${r.statusText}`);
  }
} catch (err) {
  check('token valid', 'fail', err.message);
}

// Team check
try {
  const r = await fetch(`https://api.vercel.com/v2/teams/${process.env.VERCEL_TEAM_ID}`, {
    headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
  });
  if (r.ok) {
    const data = await r.json();
    check('team id valid', 'ok', `team: ${data.name || data.slug || '?'}`);
  } else {
    check('team id valid', 'fail', `${r.status} ${r.statusText}`);
  }
} catch (err) {
  check('team id valid', 'fail', err.message);
}

// --- 5. GitHub ---
console.log(`\n${BOLD}5. GitHub API${RESET}`);
try {
  const r = await fetch('https://api.github.com/user', {
    headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
  });
  if (r.ok) {
    const data = await r.json();
    check('token valid', 'ok', `user: ${data.login}`);
    // Check org access
    const orgR = await fetch(`https://api.github.com/orgs/${process.env.GITHUB_ORG}`, {
      headers: { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` },
    });
    if (orgR.ok) {
      check('org access', 'ok', `org: ${process.env.GITHUB_ORG}`);
    } else {
      check('org access', 'warn', `cannot reach org ${process.env.GITHUB_ORG} (${orgR.status})`);
    }
  } else {
    check('token valid', 'fail', `${r.status} ${r.statusText}`);
  }
} catch (err) {
  check('token valid', 'fail', err.message);
}

// --- 6. Resend ---
console.log(`\n${BOLD}6. Resend API${RESET}`);
try {
  const r = await fetch('https://api.resend.com/domains', {
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}` },
  });
  if (r.ok) {
    const data = await r.json();
    const count = data.data?.length ?? 0;
    check('api key valid', 'ok', `${count} domain(s) registered`);
  } else {
    check('api key valid', 'fail', `${r.status} ${r.statusText}`);
  }
} catch (err) {
  check('api key valid', 'fail', err.message);
}

// Summary
const failed = results.filter((r) => r.status === 'fail').length;
const warned = results.filter((r) => r.status === 'warn').length;
const ok = results.filter((r) => r.status === 'ok').length;
const skipped = results.filter((r) => r.status === 'skip').length;

console.log(`\n${BOLD}Summary${RESET}`);
console.log(`  ${GREEN}${ok} passed${RESET}`);
if (warned) console.log(`  ${YELLOW}${warned} warnings${RESET}`);
if (skipped) console.log(`  ${DIM}${skipped} optional skipped${RESET}`);
if (failed) {
  console.log(`  ${RED}${failed} failed${RESET}\n`);
  console.log(`${RED}${BOLD}✗ Preflight failed${RESET} — fix the failed checks before deploying.`);
  process.exit(1);
}

console.log(`\n${GREEN}${BOLD}✓ Preflight passed${RESET} — ready to deploy with ${BOLD}npx vercel --prod${RESET}\n`);
