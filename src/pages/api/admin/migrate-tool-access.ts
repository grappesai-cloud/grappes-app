// ── POST /api/admin/migrate-tool-access — one-off, idempotent DDL ─────────────
// Adds `allowed_tools text[]` to public.users so the admin can restrict which
// tools a provisioned account can see/use. NULL = full access (legacy users).
// Same mechanism as migrate-marks-fonts: the deployed container ships build
// output, not src/db/migrations/*.sql, so the DDL is inlined and run via the
// app's own postgres connection (getPg → process.env.DATABASE_URL).
//
// Idempotent (ADD COLUMN IF NOT EXISTS). Guarded by ADMIN_SECRET.

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

const MIGRATION = '0033_user_tool_access.sql';

async function run(secret: string): Promise<Response> {
  const expected = e('ADMIN_SECRET');
  if (!expected) return json({ error: 'ADMIN_SECRET not configured' }, 500);
  if (!secret || !safeEqual(secret, expected)) return json({ error: 'Forbidden' }, 403);

  const sql = getPg();
  try {
    await sql.unsafe(`ALTER TABLE public.users ADD COLUMN IF NOT EXISTS allowed_tools text[];`);
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(`INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [MIGRATION]);

    const cols = await sql.unsafe(
      `SELECT column_name FROM information_schema.columns
       WHERE table_name='users' AND column_name='allowed_tools'`,
    );
    return json({ ok: true, migration: MIGRATION, columns: cols.map((r: any) => r.column_name) });
  } catch (err) {
    console.error('[migrate-tool-access] failed:', err);
    return json({ error: err instanceof Error ? err.message : 'migration failed' }, 500);
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = request.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
  return run(secret);
};
