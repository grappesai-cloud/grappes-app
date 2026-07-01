// ── Authorized SOC 2 live-recon test harness ───────────────────────────────
// Calls the in-app live-recon scanner (src/lib/soc2/live-scan.ts) DIRECTLY,
// bypassing the HTTP API / auth layer, against a domain the owner controls.
//
//   Authorization: Alexandru (owner of both grappes-app and korbee.app) has
//   authorized this run. The scanner is non-destructive recon only — security
//   headers, TLS handshake, DNS email-auth, exposed-file probes, trust pages.
//
// Run: npx tsx scripts/test-korbee-soc2.mts
// Output: ~/Desktop/korbee_soc2_results.json

import { config as loadEnv } from 'dotenv';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';

// Load env BEFORE importing the scan module — anthropic.ts reads
// ANTHROPIC_API_KEY at module-construction time. .env.local wins over .env.
loadEnv({ path: '.env.local' });
loadEnv({ path: '.env' });

const TARGET = 'korbee.app';

async function main() {
  const hasKey = !!process.env.ANTHROPIC_API_KEY;
  console.log(`[setup] ANTHROPIC_API_KEY ${hasKey ? 'loaded' : 'MISSING — scan will use deterministic summary fallback'}`);
  console.log(`[scan]  Running live recon against ${TARGET} …\n`);

  // Dynamic import so dotenv has populated process.env first.
  const { runLiveScan } = await import('../src/lib/soc2/live-scan.ts');

  const started = Date.now();
  const report = await runLiveScan(TARGET);
  const elapsedMs = Date.now() - started;

  // ── Human-readable console summary ────────────────────────────────────────
  console.log('═'.repeat(70));
  console.log(`SOC 2 LIVE RECON — ${TARGET}   (${(elapsedMs / 1000).toFixed(1)}s)`);
  console.log('═'.repeat(70));
  console.log(`\nSummary: ${report.summary}\n`);

  console.log('Scores (0-100, higher = better):');
  for (const [k, v] of Object.entries(report.scores)) {
    console.log(`  ${k.padEnd(16)} ${String(v).padStart(3)}`);
  }

  console.log(`\nFindings (${report.findings.length}):`);
  const sevRank: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  const sorted = [...report.findings].sort((a, b) => (sevRank[a.severity] ?? 9) - (sevRank[b.severity] ?? 9));
  for (const f of sorted) {
    console.log(`  [${f.severity.toUpperCase().padEnd(8)}] ${f.title}  (${f.criterion})`);
    if (f.evidence) console.log(`             evidence: ${f.evidence}`);
  }
  if (!report.findings.length) console.log('  (none — clean scan)');

  console.log(`\nScan log (${report.scanLog.length} probes):`);
  for (const l of report.scanLog) {
    console.log(`  ${String(l.target).padEnd(34)} → ${l.status}${l.note ? `  (${l.note})` : ''}`);
  }

  console.log(`\nRemediation roadmap (${report.roadmap.length}):`);
  for (const r of report.roadmap) {
    console.log(`  ${r.priority}. [${r.effort}] ${r.title}  (${r.criterion})`);
    console.log(`     ${r.detail}`);
  }

  console.log(`\nDisclaimer: ${report.disclaimer}`);

  // ── Persist full JSON ─────────────────────────────────────────────────────
  const outPath = join(homedir(), 'Desktop', 'korbee_soc2_results.json');
  const payload = {
    target: TARGET,
    scannedAt: new Date().toISOString(),
    elapsedMs,
    anthropicKeyPresent: hasKey,
    report,
  };
  await writeFile(outPath, JSON.stringify(payload, null, 2), 'utf8');
  console.log(`\n✓ Full results written to ${outPath}`);
}

main().catch((err) => {
  console.error('\n✗ Scan failed:', err);
  process.exit(1);
});
