// ── POST /api/admin/migrate-drop-billing-columns — one-off, idempotent DDL ────
// Drops the Stripe/billing columns left after the billing removal. All code
// references (queries, writes, explicit selects) were purged first; the few
// remaining `project.billing_status === ...` reads degrade safely to undefined.
// `users.plan` is intentionally KEPT (drives the 'owner' operator role + edit
// limits + admin display). Idempotent (DROP COLUMN IF EXISTS). ADMIN_SECRET.

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

const MIGRATION = '0035_drop_billing_columns.sql';
const DROPS: Array<[string, string]> = [
  ['projects', 'billing_type'],
  ['projects', 'billing_status'],
  ['projects', 'site_subscription_id'],
  ['projects', 'site_payment_intent_id'],
  ['projects', 'activated_at'],
  ['projects', 'expires_at'],
  ['users', 'stripe_customer_id'],
  ['users', 'multipage_addon'],
  ['users', 'multipage_addon_lifetime'],
  ['users', 'multipage_addon_subscription_id'],
];

async function run(secret: string): Promise<Response> {
  const expected = e('ADMIN_SECRET');
  if (!expected) return json({ error: 'ADMIN_SECRET not configured' }, 500);
  if (!secret || !safeEqual(secret, expected)) return json({ error: 'Forbidden' }, 403);

  const sql = getPg();
  try {
    for (const [table, col] of DROPS) {
      await sql.unsafe(`ALTER TABLE public.${table} DROP COLUMN IF EXISTS ${col};`);
    }
    await sql.unsafe(`
      CREATE TABLE IF NOT EXISTS _migrations (
        name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
      );
    `);
    await sql.unsafe(`INSERT INTO _migrations (name) VALUES ($1) ON CONFLICT DO NOTHING`, [MIGRATION]);

    const cols = DROPS.map(([, c]) => c);
    const remaining = await sql.unsafe(
      `SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema='public' AND column_name = ANY($1)`,
      [cols],
    );
    return json({
      ok: true,
      migration: MIGRATION,
      dropped: DROPS.map(([t, c]) => `${t}.${c}`),
      stillPresent: remaining.map((r: any) => `${r.table_name}.${r.column_name}`),
    });
  } catch (err) {
    console.error('[migrate-drop-billing-columns] failed:', err);
    return json({ error: err instanceof Error ? err.message : 'migration failed' }, 500);
  }
}

export const POST: APIRoute = async ({ request, url }) => {
  const secret = request.headers.get('x-admin-secret') || url.searchParams.get('secret') || '';
  return run(secret);
};
