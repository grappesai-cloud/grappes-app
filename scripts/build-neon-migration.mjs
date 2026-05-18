#!/usr/bin/env node
/**
 * Concatenates supabase/migrations/*.sql into src/db/migrations/0001_grappes_init.sql
 * with the transforms required to run on plain Neon Postgres without Supabase:
 *   - FK targets `auth.users(id)` → `"user"(id)` (Better-Auth's user table)
 *   - All RLS-related statements stripped (ENABLE/DISABLE ROW LEVEL SECURITY, CREATE/DROP POLICY)
 *   - GRANT/REVOKE to anon/authenticated/service_role stripped
 *   - `ALTER PUBLICATION supabase_realtime ...` stripped
 *   - `handle_new_user()` function + trigger stripped (Better-Auth hook does this now)
 *   - Functions still containing auth.uid() are left untouched but flagged in console.
 *
 * Authorization that used to live in RLS now lives in application code (API routes
 * already filter `WHERE user_id = $currentUser` — defence-in-depth).
 */

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const SUPABASE_DIR = 'supabase/migrations';
const OUT_FILE = 'src/db/migrations/0001_grappes_init.sql';

const files = readdirSync(SUPABASE_DIR).filter((f) => f.endsWith('.sql')).sort();

/**
 * Naive SQL statement splitter — splits on top-level semicolons but respects
 * `$$...$$` dollar-quoted blocks (used for plpgsql function bodies).
 * Sufficient for the supabase/migrations corpus (no nested $tag$ variants).
 */
function splitStatements(sql) {
  const stmts = [];
  let buf = '';
  let inDollar = false;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < sql.length; i++) {
    const c = sql[i];
    const next = sql[i + 1];

    // Track block comments
    if (!inDollar && !inLineComment && c === '/' && next === '*') {
      inBlockComment = true;
      buf += c;
      continue;
    }
    if (inBlockComment && c === '*' && next === '/') {
      inBlockComment = false;
      buf += c + next;
      i++;
      continue;
    }

    // Track line comments
    if (!inDollar && !inBlockComment && !inLineComment && c === '-' && next === '-') {
      inLineComment = true;
      buf += c;
      continue;
    }
    if (inLineComment && c === '\n') {
      inLineComment = false;
      buf += c;
      continue;
    }

    // Track dollar-quoted strings
    if (!inLineComment && !inBlockComment && c === '$' && next === '$') {
      inDollar = !inDollar;
      buf += '$$';
      i++;
      continue;
    }

    if (!inDollar && !inLineComment && !inBlockComment && c === ';') {
      buf += ';';
      stmts.push(buf);
      buf = '';
      continue;
    }
    buf += c;
  }
  if (buf.trim()) stmts.push(buf);
  return stmts;
}

const STRIP_PATTERNS = [
  /^\s*ALTER\s+TABLE\s+[^\n;]+(ENABLE|DISABLE)\s+ROW\s+LEVEL\s+SECURITY\b/i,
  /^\s*(CREATE|DROP)\s+POLICY\b/i,
  /^\s*GRANT\b[\s\S]+\b(anon|authenticated|service_role)\b/i,
  /^\s*REVOKE\b[\s\S]+\b(anon|authenticated|service_role)\b/i,
  /^\s*ALTER\s+PUBLICATION\s+supabase_realtime\b/i,
];

let stripped = 0;
let authUidStillPresent = 0;

const out = [
  '-- ===========================================================================',
  '-- Grappes core schema — Neon-ready (auto-generated from supabase/migrations/)',
  '-- ===========================================================================',
  '-- Source migrations: ' + files.join(', '),
  '-- Generator: scripts/build-neon-migration.mjs',
  '',
  'CREATE EXTENSION IF NOT EXISTS pgcrypto;',
  '',
];

for (const f of files) {
  let raw = readFileSync(join(SUPABASE_DIR, f), 'utf8');

  // Repoint FK targets and table refs.
  raw = raw.replace(/REFERENCES\s+auth\.users\s*\(\s*id\s*\)/gi, 'REFERENCES "user"(id)');
  raw = raw.replace(/auth\.users\b/gi, '"user"');

  // Strip handle_new_user trigger/function block (greedy match).
  // It's defined exactly once; remove the function and its trigger.
  raw = raw.replace(
    /CREATE\s+(OR\s+REPLACE\s+)?FUNCTION\s+(public\.)?handle_new_user[\s\S]+?LANGUAGE\s+plpgsql\s+SECURITY\s+DEFINER\s*;?/gi,
    '-- (handle_new_user function removed — Better-Auth manages user creation)'
  );
  raw = raw.replace(
    /CREATE\s+TRIGGER\s+on_auth_user_created[\s\S]+?(?=;)\s*;?/gi,
    '-- (on_auth_user_created trigger removed)'
  );

  const stmts = splitStatements(raw);
  const kept = [];
  for (const stmt of stmts) {
    // Strip leading SQL comments (`-- ...` lines and `/* ... */`) so the
    // pattern check sees the actual statement keyword.
    let cleaned = stmt.replace(/\/\*[\s\S]*?\*\//g, '');
    cleaned = cleaned
      .split('\n')
      .filter((l) => !/^\s*--/.test(l))
      .join('\n')
      .trimStart();
    const head = cleaned.slice(0, 400);
    if (STRIP_PATTERNS.some((re) => re.test(head))) {
      stripped++;
      continue;
    }
    if (/auth\.uid\s*\(/i.test(stmt)) {
      // Likely inside a CREATE POLICY (already stripped) or a function body.
      // If it's a CREATE FUNCTION, skip it — it can't run on plain Postgres without auth.uid().
      if (/CREATE\s+(OR\s+REPLACE\s+)?FUNCTION/i.test(head)) {
        authUidStillPresent++;
        kept.push('-- (function stripped — referenced auth.uid()):');
        kept.push(stmt.split('\n').map((l) => '-- ' + l).join('\n'));
        continue;
      }
      authUidStillPresent++;
    }
    kept.push(stmt);
  }

  out.push('');
  out.push('-- ──────────────────────────────────────────────');
  out.push(`-- Source: ${f}`);
  out.push('-- ──────────────────────────────────────────────');
  out.push(kept.join('\n').trim());
  out.push('');
}

writeFileSync(OUT_FILE, out.join('\n'));
console.log(`Wrote ${OUT_FILE}`);
console.log(`Stripped ${stripped} Supabase-specific statements (RLS, role grants, realtime).`);
if (authUidStillPresent > 0) {
  console.log(`⚠  ${authUidStillPresent} statement(s) referenced auth.uid() and were commented out — review the output.`);
}
