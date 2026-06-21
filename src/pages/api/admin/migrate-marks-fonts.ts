// ── POST /api/admin/migrate-marks-fonts — one-off, idempotent DDL ─────────────
// Adds the Brand Book Lab phase-2 columns (symbol_url, badge_url, custom_fonts)
// to press_kits on the live DB. The deployed container ships the build output,
// not src/db/migrations/*.sql, so the DDL is inlined here and run via the same
// postgres connection the app uses (getPg → process.env.DATABASE_URL).
//
// Idempotent (ADD COLUMN IF NOT EXISTS). Guarded by ADMIN_SECRET. Safe to call
// more than once; safe to leave deployed.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getPg } from '../../../lib/supabase';
import { e } from '../../../lib/env';
import { json } from '../../../lib/api-utils';

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

const MIGRATION = '0032_brand_book_marks_fonts.sql';

async function run(secret: string): Promise<Response> {
  const expected = e('ADMIN_SECRET');
  if (!expected) return json({ error: 'ADMIN_SECRET not configured' }, 500);
  if (!secret || !safeEqual(secret, expected)) return json({ error: 'Forbidden' }, 403);

  const sql = getPg();
  try {
    await sql.unsafe(`
      ALTER TABLE press_kits
        ADD COLUMN IF NOT EXISTS symbol_url   TEXT,
        ADD COLUMN IF NOT EXISTS badge_url    TEXT,
        ADD COLUMN IF NOT EXISTS custom_fonts JSONB;
    `);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(`INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [MIGRATION]);

    const cols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='press_kits' AND column_name IN ('symbol_url','badge_url','custom_fonts')
       ORDER BY column_name`,
    );
    return json({ ok: true, migration: MIGRATION, columns: cols.map((r: any) => r.column_name) });
  } catch (err) {
    console.error('[migrate-marks-fonts] failed:', err);
    return json({ error: err instanceof Error ? err.message : 'migration failed' }, 500);
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = request.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
  return run(secret);
};
