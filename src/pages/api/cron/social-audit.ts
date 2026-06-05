// ─── Cron: weekly social audit refresh ───────────────────────────────────────
// Sundays 18:00 UTC. Regenerates the audit for every user with at least one
// active connection. Cache-aware: unchanged inputs cost nothing.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { isNull } from 'drizzle-orm';
import { json } from '../../../lib/api-utils';
import { db } from '../../../db';
import { socialConnections } from '../../../db/schema/social';
import { regenerateAudit } from '../../../lib/social/audit';

export const prerender = false;
export const config = { maxDuration: 300 } as any;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!safeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const rows = await db
    .selectDistinct({ userId: socialConnections.userId })
    .from(socialConnections)
    .where(isNull(socialConnections.disconnectedAt));

  let ok = 0;
  let cachedHits = 0;
  let failed = 0;
  for (const { userId } of rows) {
    try {
      const r = await regenerateAudit(userId);
      ok++;
      if (r.cached) cachedHits++;
    } catch (err) {
      failed++;
      console.error('[cron/social-audit] user', userId, 'failed', err);
    }
  }

  const result = { users: rows.length, ok, cachedHits, failed };
  console.log('[cron/social-audit]', result);
  return json(result);
};
