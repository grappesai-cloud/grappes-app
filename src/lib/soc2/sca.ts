// ── SOC 2 Software Composition Analysis (SCA) ──────────────────────────────
// Real dependency-vulnerability scanning via the free OSV.dev API (no binary,
// runs in a serverless function). Parses the lockfile for exact versions, batch-
// queries OSV, and turns known CVEs into Findings mapped to CC7.1 (vulnerability
// management). This fills the biggest blind spot of the old regex-only engine.

import type { Finding, Severity } from './static-checks';
import type { CodeFile } from './static-checks';

interface OsvSeverity { type: string; score: string }
interface OsvAffected {
  package?: { name?: string; ecosystem?: string };
  ranges?: { type?: string; events?: { introduced?: string; fixed?: string }[] }[];
}
interface OsvVuln {
  id: string;
  summary?: string;
  details?: string;
  aliases?: string[];
  severity?: OsvSeverity[];
  affected?: OsvAffected[];
  references?: { type?: string; url?: string }[];
  database_specific?: { severity?: string };
}

interface Dep { name: string; version: string }

/** Parse exact dependency versions from a package-lock.json (npm v2/v3). */
function parseNpmLock(content: string): Dep[] {
  const out: Dep[] = [];
  try {
    const lock = JSON.parse(content);
    if (lock.packages && typeof lock.packages === 'object') {
      for (const [key, val] of Object.entries<any>(lock.packages)) {
        if (!key || !key.startsWith('node_modules/')) continue; // skip root ""
        const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
        if (val?.version) out.push({ name, version: String(val.version) });
      }
    } else if (lock.dependencies && typeof lock.dependencies === 'object') {
      // npm v1 lock
      const walk = (deps: any) => {
        for (const [name, v] of Object.entries<any>(deps)) {
          if (v?.version) out.push({ name, version: String(v.version) });
          if (v?.dependencies) walk(v.dependencies);
        }
      };
      walk(lock.dependencies);
    }
  } catch { /* malformed lock */ }
  // dedupe by name@version
  const seen = new Set<string>();
  return out.filter((d) => { const k = `${d.name}@${d.version}`; if (seen.has(k)) return false; seen.add(k); return true; });
}

/** Direct (top-level) dependencies — a cheap reachability proxy: your code can
 *  import these, whereas a deep transitive dep is a dependency-of-a-dependency. */
function directDeps(content: string): Set<string> {
  try {
    const lock = JSON.parse(content);
    const root = lock.packages?.[''] ?? {};
    return new Set([...Object.keys(root.dependencies ?? {}), ...Object.keys(root.devDependencies ?? {}), ...Object.keys(root.optionalDependencies ?? {})]);
  } catch { return new Set(); }
}

function pickLockfile(files: CodeFile[]): CodeFile | null {
  return files.find((f) => /(^|\/)package-lock\.json$/.test(f.path))
      ?? files.find((f) => /(^|\/)npm-shrinkwrap\.json$/.test(f.path))
      ?? null;
}

/** Map an OSV vuln to our Severity + a CVSS base score when available. */
function severityOf(v: OsvVuln): { severity: Severity; cvss?: number } {
  // 1) GHSA database_specific.severity (CRITICAL/HIGH/MODERATE/LOW)
  const ds = v.database_specific?.severity?.toUpperCase();
  const map: Record<string, Severity> = { CRITICAL: 'critical', HIGH: 'high', MODERATE: 'medium', MEDIUM: 'medium', LOW: 'low' };
  // 2) CVSS vector → base score (extract from the vector string heuristically)
  let cvss: number | undefined;
  const vec = v.severity?.find((s) => /CVSS/i.test(s.type))?.score;
  if (vec) {
    const m = /(?:^|\/)(?:CVSS:3\.\d\/)?.*?$/.exec(vec); // vectors don't embed the score; leave to ds
    // Some OSV entries put a numeric score directly.
    const num = parseFloat(vec);
    if (!Number.isNaN(num) && num >= 0 && num <= 10) cvss = num;
  }
  if (cvss == null && ds) cvss = ds === 'CRITICAL' ? 9.5 : ds === 'HIGH' ? 7.5 : ds === 'MODERATE' || ds === 'MEDIUM' ? 5 : 3;
  let severity: Severity = (ds && map[ds]) || 'medium';
  if (!ds && cvss != null) severity = cvss >= 9 ? 'critical' : cvss >= 7 ? 'high' : cvss >= 4 ? 'medium' : 'low';
  return { severity, cvss };
}

function fixedVersion(v: OsvVuln, dep: Dep): string | null {
  for (const a of v.affected ?? []) {
    if (a.package?.name && a.package.name !== dep.name) continue;
    for (const r of a.ranges ?? []) {
      for (const e of r.events ?? []) if (e.fixed) return e.fixed;
    }
  }
  return null;
}

export interface ScaResult {
  findings: Finding[];
  stats: { dependencies: number; vulnerable: number; lockfile: string | null };
}

async function osvBatch(deps: Dep[]): Promise<Map<string, string[]>> {
  // Returns dep-key -> [vulnIds]
  const out = new Map<string, string[]>();
  const CHUNK = 200;
  for (let i = 0; i < deps.length; i += CHUNK) {
    const chunk = deps.slice(i, i + CHUNK);
    const body = { queries: chunk.map((d) => ({ package: { name: d.name, ecosystem: 'npm' }, version: d.version })) };
    let res: Response;
    try {
      res = await fetch('https://api.osv.dev/v1/querybatch', {
        method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
      });
    } catch { continue; }
    if (!res.ok) continue;
    const json = (await res.json()) as { results?: { vulns?: { id: string }[] }[] };
    (json.results ?? []).forEach((r, idx) => {
      const ids = (r.vulns ?? []).map((x) => x.id).filter(Boolean);
      if (ids.length) out.set(`${chunk[idx].name}@${chunk[idx].version}`, ids);
    });
  }
  return out;
}

async function osvDetails(id: string): Promise<OsvVuln | null> {
  try {
    const res = await fetch(`https://api.osv.dev/v1/vulns/${encodeURIComponent(id)}`);
    if (!res.ok) return null;
    return (await res.json()) as OsvVuln;
  } catch { return null; }
}

/** EPSS exploitation-probability (0..1) per CVE, via the free FIRST.org API. */
async function epssScores(cves: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const real = [...new Set(cves.filter((c) => /^CVE-/.test(c)))];
  for (let i = 0; i < real.length; i += 80) {
    const chunk = real.slice(i, i + 80);
    try {
      const res = await fetch(`https://api.first.org/data/v1/epss?cve=${chunk.join(',')}`);
      if (!res.ok) continue;
      const json = (await res.json()) as { data?: { cve: string; epss: string }[] };
      for (const d of json.data ?? []) out.set(d.cve, parseFloat(d.epss));
    } catch { /* EPSS optional */ }
  }
  return out;
}

export async function runSca(files: CodeFile[]): Promise<ScaResult> {
  const lock = pickLockfile(files);
  if (!lock) {
    return {
      findings: [{
        id: 'sca-no-lockfile', title: 'No lockfile found — dependencies cannot be vulnerability-scanned',
        severity: 'medium', criterion: 'security', source: 'sca', control: 'CC7.1',
        detail: 'Without a committed package-lock.json the exact installed dependency versions are unknown, so known-CVE scanning (and reproducible builds) is not possible. SOC 2 vulnerability management (CC7.1) expects dependency monitoring.',
        fix: 'Commit package-lock.json (npm) / pnpm-lock.yaml / yarn.lock and enable automated dependency scanning (Dependabot, Renovate, or `npm audit` in CI).',
      }],
      stats: { dependencies: 0, vulnerable: 0, lockfile: null },
    };
  }
  const deps = parseNpmLock(lock.content);
  if (deps.length === 0) return { findings: [], stats: { dependencies: 0, vulnerable: 0, lockfile: lock.path } };
  const direct = directDeps(lock.content);

  const hits = await osvBatch(deps);
  const uniqueIds = [...new Set([...hits.values()].flat())];
  // Bound detail fetches.
  const details = new Map<string, OsvVuln>();
  for (const id of uniqueIds.slice(0, 150)) {
    const d = await osvDetails(id);
    if (d) details.set(id, d);
  }

  const findings: Finding[] = [];
  const findingCves = new Map<string, string[]>();
  const depByKey = new Map(deps.map((d) => [`${d.name}@${d.version}`, d]));
  let vulnerable = 0;
  for (const [key, ids] of hits.entries()) {
    const dep = depByKey.get(key)!;
    vulnerable++;
    // Worst severity for this dep drives one finding; list all CVEs.
    const vulns = ids.map((id) => details.get(id)).filter(Boolean) as OsvVuln[];
    if (vulns.length === 0) continue;
    let worst: { severity: Severity; cvss?: number } = { severity: 'low' };
    const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
    for (const v of vulns) {
      const s = severityOf(v);
      if (order.indexOf(s.severity) > order.indexOf(worst.severity)) worst = s;
    }
    const cves = vulns.map((v) => v.aliases?.find((a) => a.startsWith('CVE-')) ?? v.id);
    const cveList = cves.slice(0, 6).join(', ');
    const fid = `sca-${dep.name.replace(/[^a-z0-9]/gi, '-')}-${dep.version}`;
    findingCves.set(fid, cves);
    const fix = vulns.map((v) => fixedVersion(v, dep)).filter(Boolean) as string[];
    const fixHint = fix.length ? `Upgrade ${dep.name} to ${fix.sort().pop()} or later.` : `Upgrade ${dep.name} to a non-vulnerable version (no fixed version published yet — consider a replacement or mitigation).`;
    findings.push({
      id: fid,
      title: `Vulnerable dependency: ${dep.name}@${dep.version} (${vulns.length} known ${vulns.length === 1 ? 'CVE' : 'CVEs'})`,
      severity: worst.severity,
      cvss: worst.cvss,
      criterion: 'security',
      control: 'CC7.1',
      source: 'sca',
      reachable: direct.has(dep.name),
      detail: `${dep.name}@${dep.version}${direct.has(dep.name) ? '' : ' (transitive dependency — not imported directly)'} has known vulnerabilities: ${cveList}. ${vulns[0]?.summary ?? ''}`.trim(),
      fix: fixHint,
      evidence: `${lock.path} → ${dep.name}@${dep.version}`,
    });
  }
  // EPSS enrichment: attach the real-world exploitation likelihood so a high-CVSS
  // CVE that nobody actually exploits is ranked below a lower-CVSS one that is.
  const allCves = [...new Set([...findingCves.values()].flat())];
  const epss = await epssScores(allCves);
  for (const f of findings) {
    const maxEpss = Math.max(0, ...(findingCves.get(f.id) ?? []).map((c) => epss.get(c) ?? 0));
    if (maxEpss > 0) {
      f.epss = maxEpss;
      f.detail += ` EPSS ${(maxEpss * 100).toFixed(1)}% (exploitation likelihood, next 30 days).`;
      if ((f.severity === 'high' || f.severity === 'critical') && maxEpss < 0.01) {
        f.detail += ' Low real-world exploit likelihood — can be triaged below actively-exploited CVEs.';
      }
    }
  }

  // Rank by severity, then by EPSS within a severity tier.
  const order: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
  findings.sort((a, b) => (order.indexOf(b.severity) - order.indexOf(a.severity)) || ((b.epss ?? 0) - (a.epss ?? 0)));
  return { findings, stats: { dependencies: deps.length, vulnerable, lockfile: lock.path } };
}
