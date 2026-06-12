// SOC 2 SAST worker (GitHub Actions). Real semantic SAST that needs binaries,
// so it runs on a runner (not Vercel): Semgrep (taint/data-flow rulesets) +
// gitleaks (secrets across full git history). The workflow runs the tools and
// drops their reports; this script normalizes them into Findings, runs them
// through the SAME adversarial verification as the in-function engines (so CI
// placeholders and doc-mentions get filtered, not shipped as criticals), and
// writes the survivors onto the soc2_assessments row in Neon directly.
//
// Env: ASSESSMENT_ID, DATABASE_URL, SEMGREP_SARIF, GITLEAKS_JSON, ANTHROPIC_API_KEY.

import fs from 'node:fs';
import postgres from 'postgres';
import type { Finding, Severity } from '../src/lib/soc2/static-checks';
import { verifyFindings } from '../src/lib/soc2/verify-findings';

function readJson(path: string): any | null {
  try { return JSON.parse(fs.readFileSync(path, 'utf8')); } catch { return null; }
}

function readJsonl(path: string): any[] {
  try {
    return fs.readFileSync(path, 'utf8').split('\n').filter(Boolean)
      .map((l) => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// trufflehog --only-verified: every entry is a secret CONFIRMED still valid
// against its provider. These bypass the FP filter + adversarial verification —
// they are proven-live, not candidates.
function trufflehogFindings(lines: any[]): Finding[] {
  return lines.filter((x) => x.Verified).slice(0, 100).map((x, i) => {
    const md = x.SourceMetadata?.Data?.Git ?? x.SourceMetadata?.Data?.Filesystem ?? {};
    const file = md.file ?? '';
    const line = md.line ?? '';
    return {
      id: `sast-livesecret-${x.DetectorName ?? 'secret'}-${i}`,
      title: `VERIFIED LIVE secret: ${x.DetectorName ?? 'credential'} (${file}${line ? `:${line}` : ''})`,
      severity: 'critical' as Severity,
      criterion: 'security' as const, control: 'CC6.7', source: 'sast' as const,
      confidence: 0.98, verified: true,
      detail: `A ${x.DetectorName ?? 'credential'} was found AND confirmed still valid — it authenticates against the provider. This is an active, exploitable exposure, not a guess.`,
      fix: 'Rotate this credential NOW, then purge it from git history (git filter-repo / BFG) and enable push protection.',
      evidence: `${file}${line ? `:${line}` : ''}${md.commit ? ` (commit ${String(md.commit).slice(0, 8)})` : ''}`,
    };
  });
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
        severity, criterion: 'security', control: 'CC6.1', source: 'sast',
        detail: `${res.message?.text ?? ruleId}${cwe ? ` [${cwe}]` : ''}`,
        fix: meta.fix ?? 'Review and remediate per the Semgrep rule guidance.',
        evidence: `${file}:${line}`,
      });
    }
  }
  return out;
}

// Deterministic pre-filter for the obvious gitleaks false positives that don't
// need an LLM: a secret "found" inside documentation, or a PEM header with no
// actual key body, or a CI/test placeholder value.
function isLikelyFp(g: any): boolean {
  const file = String(g.File ?? '').toLowerCase();
  const match = String(g.Match ?? g.Secret ?? '');
  if (/\.(md|mdx|txt|rst|adoc)$|(^|\/)docs?\//.test(file)) return true;
  if (/-----BEGIN [^-]+-----/.test(match) && !/[A-Za-z0-9+/=]{40,}/.test(match)) return true;
  if (/(^|\/)(\.github\/workflows|ci|tests?|examples?|samples?|fixtures?)\//.test(file)
      && /\b(ci-|dummy|test|example|sample|placeholder|changeme|xxx|fake|dev-)/i.test(match)) return true;
  return false;
}

function gitleaksFindings(report: any): Finding[] {
  const arr = Array.isArray(report) ? report : [];
  return arr
    .filter((g: any) => !isLikelyFp(g))
    .slice(0, 200)
    .map((g: any, i: number) => ({
      id: `sast-secret-${(g.RuleID ?? 'leak')}-${i}`,
      title: `Secret in git history: ${g.RuleID ?? 'credential'} (${g.File}:${g.StartLine})`,
      severity: 'critical' as Severity,
      criterion: 'security' as const, control: 'CC6.7', source: 'sast' as const,
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

  const rawSecrets = Array.isArray(gitleaks) ? gitleaks.length : 0;
  let findings = [...semgrepFindings(sarif ?? {}), ...gitleaksFindings(gitleaks ?? [])];
  const beforeVerify = findings.length;

  // Same adversarial verification as the in-function engines — drops confident
  // false positives and attaches confidence/CVSS. Best-effort.
  try {
    findings = await verifyFindings(findings);
  } catch (e) {
    console.warn('[sast] adversarial verification skipped:', (e as any)?.message ?? e);
  }

  // Verified-live secrets bypass the FP filter + verification — they are proven.
  const live = trufflehogFindings(readJsonl(process.env.TRUFFLEHOG_JSON || 'trufflehog.json'));
  findings = [...live, ...findings];

  const stats = {
    semgrep: (sarif?.runs?.[0]?.results ?? []).length,
    secrets: rawSecrets,
    liveSecrets: live.length,
    findings: findings.length,
    filteredFp: beforeVerify - (findings.length - live.length),
    ranAt: new Date().toISOString(),
  };
  console.log(`[sast] ${stats.semgrep} semgrep, ${rawSecrets} raw secrets -> ${beforeVerify} findings -> ${findings.length} after verification`);

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
