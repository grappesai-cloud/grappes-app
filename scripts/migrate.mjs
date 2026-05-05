#!/usr/bin/env node
/**
 * Apply all SQL files in src/db/migrations/ to the database at DATABASE_URL,
 * in lexicographic order. Idempotent: tracks applied migrations in a
 * `_migrations` table so re-running is a no-op.
 *
 * Usage:
 *   DATABASE_URL=postgresql://... node scripts/migrate.mjs
 *   DATABASE_URL=postgresql://... node scripts/migrate.mjs --reset   # drop _migrations first
 */

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import postgres from 'postgres';

const url = process.env.DATABASE_URL;
if (!url) {
  console.error('DATABASE_URL is required');
  process.exit(1);
}

const sql = postgres(url, { onnotice: () => {} });

const RESET = process.argv.includes('--reset');

async function main() {
  if (RESET) {
    console.log('Dropping _migrations (--reset)…');
    await sql`DROP TABLE IF EXISTS _migrations`;
  }

  await sql`
    CREATE TABLE IF NOT EXISTS _migrations (
      name        text PRIMARY KEY,
      applied_at  timestamptz NOT NULL DEFAULT now()
    )
  `;

  const dir = 'src/db/migrations';
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

  for (const file of files) {
    const [{ count }] = await sql`SELECT count(*)::int FROM _migrations WHERE name = ${file}`;
    if (count > 0) {
      console.log(`✓ ${file} (already applied)`);
      continue;
    }

    const body = readFileSync(join(dir, file), 'utf8');
    process.stdout.write(`→ ${file} … `);

    try {
      await sql.begin(async (tx) => {
        await tx.unsafe(body);
        await tx`INSERT INTO _migrations (name) VALUES (${file})`;
      });
      console.log('done');
    } catch (err) {
      console.log('FAILED');
      console.error(err);
      process.exit(1);
    }
  }

  await sql.end();
  console.log('Migrations up-to-date.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
