// ── Cron: continuous SOC 2 monitoring ──────────────────────────────────────
// Re-scans due monitors with the deterministic deep engines (OSV SCA + authz +
// GitHub evidence — no AI cost), detects drift vs the stored baseline (a new CVE,
// a newly-unauthenticated endpoint, a regressed control), and updates the
// monitor. Bounded per tick to keep runs cheap.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { getPg } from '../../../lib/supabase';
import { runDeepEngines } from '../../../lib/soc2/deep-engines';
import { json } from '../../../lib/api-utils';

export const maxDuration = 800;

const PENALTY: Record<string, number> = { critical: 25, high: 15, medium: 8, low: 3, info: 0 };
const PER_TICK = 8;

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) return new Response('CRON_SECRET not configured', { status: 500 });
  if (!safeCompare(request.headers.get('authorization') ?? '', `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const sql = getPg();
  const due = await sql<{ id: string; target: string; last_overall: number | null; baseline: string[] | null }[]>`
    SELECT id, target, last_overall, baseline
    FROM soc2_monitors
    WHERE active = true
      AND (last_run_at IS NULL
           OR last_run_at < now() - (CASE cadence WHEN 'daily' THEN interval '1 day' ELSE interval '7 days' END))
    ORDER BY last_run_at ASC NULLS FIRST
    LIMIT ${PER_TICK}
  `;

  const results: any[] = [];
  for (const m of due) {
    const deep = await runDeepEngines(m.target).catch(() => null);
    if (!deep) {
      await sql`UPDATE soc2_monitors SET last_run_at = now(), updated_at = now() WHERE id = ${m.id}`;
      results.push({ target: m.target, error: 'scan failed' });
      continue;
    }
    const findings = deep.findings;
    const penalty = findings.reduce((s, f) => s + (PENALTY[f.severity] ?? 0), 0);
    const overall = Math.max(0, Math.min(100, 100 - penalty));
    const ids = findings.map((f) => f.id);
    const baseline = Array.isArray(m.baseline) ? m.baseline : [];
    const newIds = ids.filter((id) => !baseline.includes(id));
    const drift = (m.last_overall != null && overall < m.last_overall - 3) || newIds.length > 0;

    await sql`UPDATE soc2_monitors
      SET last_run_at = now(), last_overall = ${overall}, last_findings = ${findings.length},
          baseline = ${sql.json(ids)}, updated_at = now()
      WHERE id = ${m.id}`;

    if (drift) {
      console.warn(`[soc2-monitor] DRIFT on ${m.target}: overall ${m.last_overall ?? '—'}→${overall}, ${newIds.length} new finding(s): ${newIds.slice(0, 5).join(', ')}`);
    }
    results.push({ target: m.target, overall, prev: m.last_overall, drift, newFindings: newIds.length });
  }

  return json({ processed: results.length, results });
};
