// ── POST /api/admin/migrate-drop-dead-tables — one-off, idempotent DDL ────────
// Drops fully-dead standalone tables left over after the Stripe / old
// auto-generation cleanup. Only tables with ZERO references in the codebase are
// dropped here; columns on live tables (users/projects) are intentionally left.
// Same mechanism as migrate-tool-access: inlined DDL run via the app's own
// postgres connection (getPg). Idempotent (DROP TABLE IF EXISTS). Guarded by
// ADMIN_SECRET.

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

const MIGRATION = '0034_drop_dead_tables.sql';
const DEAD_TABLES = [
  'stripe_processed_events', // Stripe webhook idempotency (Stripe removed)
  'generation_jobs',         // old auto-gen queue (concierge flow now)
  'studio_characters',       // orphaned — 0 code references
  'studio_prompts',          // orphaned — 0 code references
  'studio_reels',            // orphaned — 0 code references
  'savoy_posts',             // orphaned — 0 code references
];

async function run(secret: string): Promise<Response> {
  const expected = e('ADMIN_SECRET');
  if (!expected) return json({ error: 'ADMIN_SECRET not configured' }, 500);
  if (!secret || !safeEqual(secret, expected)) return json({ error: 'Forbidden' }, 403);

  const sql = getPg();
  try {
    for (const t of DEAD_TABLES) {
      await sql.unsafe(`DROP TABLE IF EXISTS public.${t} CASCADE;`);
    }
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(`INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [MIGRATION]);

    const remaining = await sql.unsafe(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name = ANY($1)`,
      [DEAD_TABLES],
    );
    return json({
      ok: true,
      migration: MIGRATION,
      dropped: DEAD_TABLES,
      stillPresent: remaining.map((r: any) => r.table_name),
    });
  } catch (err) {
    console.error('[migrate-drop-dead-tables] failed:', err);
    return json({ error: err instanceof Error ? err.message : 'migration failed' }, 500);
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = request.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
  return run(secret);
};
