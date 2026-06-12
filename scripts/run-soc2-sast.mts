// SOC 2 SAST worker (GitHub Actions). Real semantic SAST that needs binaries,
// so it runs on a runner (not Vercel): Semgrep (taint/data-flow rulesets) +
// gitleaks (secrets across full git history). The workflow runs the tools and
// drops their reports; this script normalizes them into Findings and writes them
// onto the soc2_assessments row in Neon directly (same pattern as the generation
// worker — no callback endpoint needed).
//
// Env: ASSESSMENT_ID, DATABASE_URL, SEMGREP_SARIF (default semgrep.sarif),
//      GITLEAKS_JSON (default gitleaks.json), TARGET (label).

import fs from 'node:fs';
import postgres from 'postgres';

type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';
interface Finding {
  id: string; title: string; severity: Severity; criterion: string;
  detail: string; fix: string; evidence?: string; source: 'sast'; control?: string;
}

function readJson(path: string): any | null {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}

function semgrepFindings(sarif: any): Finding[] {
  const out: Finding[] = [];
  for (const run of sarif?.runs ?? []) {
    const rules = new Map<string, any>();
    for (const r of run?.tool?.driver?.rules ?? []) rules.set(r.id, r);
    for (const res of run?.results ?? []) {
      const level = String(res.level ?? 'warning');
      const severity: Severity = level === 'error' ? 'high' : level === 'warning' ? 'medium' : 'low';
      const loc = res.locations?.[0]?.physicalLocation;
      const file = loc?.artifactLocation?.uri ?? '';
      const line = loc?.region?.startLine ?? '';
      const ruleId = String(res.ruleId ?? 'semgrep');
      const meta = rules.get(ruleId)?.properties ?? {};
      const cwe = (meta.cwe?.[0] ?? '').toString();
      out.push({
        id: `sast-${ruleId.replace(/[^a-z0-9]/gi, '-').slice(0, 50)}-${file}-${line}`.slice(0, 120),
        title: `${ruleId.split('.').pop()} (${file}:${line})`,
        severity,
        criterion: 'security',
        control: 'CC6.1',
        source: 'sast',
        detail: `${res.message?.text ?? ruleId}${cwe ? ` [${cwe}]` : ''}`,
        fix: meta.fix ?? 'Review and remediate per the Semgrep rule guidance.',
        evidence: `${file}:${line}`,
      });
    }
  }
  return out;
}

function gitleaksFindings(report: any): Finding[] {
  const arr = Array.isArray(report) ? report : [];
  return arr.slice(0, 200).map((g: any, i: number) => ({
    id: `sast-secret-${(g.RuleID ?? 'leak')}-${i}`,
    title: `Secret in git history: ${g.RuleID ?? 'credential'} (${g.File}:${g.StartLine})`,
    severity: 'critical' as Severity,
    criterion: 'security',
    control: 'CC6.7',
    source: 'sast' as const,
    detail: `${g.Description ?? 'A secret was committed'}. It is in the git history and must be considered compromised even if removed from the current code.`,
    fix: 'Rotate the exposed credential immediately, then purge it from history (git filter-repo / BFG) and enable push protection.',
    evidence: `${g.File}:${g.StartLine} (commit ${String(g.Commit ?? '').slice(0, 8)})`,
  }));
}

async function main() {
  const assessmentId = process.env.ASSESSMENT_ID?.trim();
  if (!assessmentId) { console.error('[sast] ASSESSMENT_ID missing'); process.exit(1); }

  const sarif = readJson(process.env.SEMGREP_SARIF || 'semgrep.sarif');
  const gitleaks = readJson(process.env.GITLEAKS_JSON || 'gitleaks.json');
  const findings = [...semgrepFindings(sarif ?? {}), ...gitleaksFindings(gitleaks ?? [])];
  const stats = {
    semgrep: (sarif?.runs?.[0]?.results ?? []).length,
    secrets: Array.isArray(gitleaks) ? gitleaks.length : 0,
    ranAt: new Date().toISOString(),
  };
  console.log(`[sast] ${stats.semgrep} semgrep results, ${stats.secrets} secrets -> ${findings.length} findings`);

  const sql = postgres(process.env.DATABASE_URL!, { prepare: false });
  try {
    const rows = await sql`SELECT report FROM soc2_assessments WHERE id=${assessmentId} LIMIT 1`;
    if (!rows[0]) { console.error('[sast] assessment not found'); process.exit(1); }
    const report = (rows[0].report as any) ?? {};
    report.sast = { findings, stats };
    await sql`UPDATE soc2_assessments SET report=${sql.json(report)} WHERE id=${assessmentId}`;
    console.log('[sast] wrote SAST results to assessment', assessmentId);
  } finally {
    await sql.end({ timeout: 5 });
  }
  process.exit(0);
}

main().catch((e) => { console.error('[sast] fatal:', e); process.exit(1); });
