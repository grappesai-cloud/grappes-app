// ── SOC 2 adversarial finding verification ─────────────────────────────────
// A skeptical second pass over automated findings. Scanners (regex, AI, the
// authz heuristic) produce false positives that destroy credibility — a "SQLi"
// that's a template-literal rate-limit key, an "unauthenticated" endpoint that's
// an intentionally-public contact form. This pass tries to REFUTE each finding,
// assigns a confidence + CVSS, drops high-confidence false positives, and marks
// the rest verified. Externally-verified sources (OSV CVEs, API evidence) are
// trusted as-is and skip the model.

import { createMessage } from '../anthropic';
import type { Finding, Severity } from './static-checks';

const VERIFY_MODEL = 'claude-sonnet-4-6';
const FACTUAL: ReadonlySet<Finding['source']> = new Set(['sca', 'evidence']);
const BATCH = 30;

function extractJson(text: string): any {
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const raw = fence ? fence[1] : text;
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end < 0) return {};
  try { return JSON.parse(raw.slice(start, end + 1)); } catch { return {}; }
}

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

const SEV_ORDER: Severity[] = ['info', 'low', 'medium', 'high', 'critical'];
function downgrade(s: Severity): Severity {
  const i = SEV_ORDER.indexOf(s);
  return SEV_ORDER[Math.max(0, i - 1)];
}
function severityFromCvss(c: number): Severity {
  return c >= 9 ? 'critical' : c >= 7 ? 'high' : c >= 4 ? 'medium' : c > 0 ? 'low' : 'info';
}

function buildPrompt(batch: Finding[]): string {
  const list = batch.map((f, i) => `${i + 1}. id="${f.id}" [${f.severity}/${f.criterion}/${f.source}] ${f.title}
   detail: ${f.detail}
   evidence: ${f.evidence ?? '(none)'}`).join('\n');

  return `You are a senior application-security engineer verifying findings produced by automated scanners before they go into a SOC 2 readiness report. Your job is to be a SKEPTIC: for each finding, actively try to REFUTE it. Many automated findings are false positives.

Known false-positive patterns to catch:
- A "SQL injection" that is actually a parameterized query, an ORM call (Drizzle/Prisma), or a template literal used as a cache/rate-limit key — not interpolated SQL.
- An "unauthenticated endpoint" that is intentionally public by design: contact forms, analytics/telemetry beacons, public webhooks authenticated by signature, health checks, the auth provider's own catch-all route, public form submissions from generated sites.
- A "hardcoded secret" that is a placeholder, an example, a public key, or a non-secret constant.
- A "missing authorization / IDOR" where ownership IS checked elsewhere or the id is not user-controlled.

For EACH finding, decide:
- verdict: "real" (genuine issue), "false_positive" (not a real issue), or "uncertain" (can't tell without more context — default here when unsure).
- confidence: 0.0–1.0 that your verdict is correct.
- cvss: 0.0–10.0 base score if it's a real vulnerability, else 0.
- reason: one terse sentence justifying the verdict.

Be conservative: only mark "false_positive" when you're genuinely confident it's benign. When in doubt, "uncertain".

FINDINGS:
${list}

Return ONLY JSON:
{ "verdicts": [ { "id": "<finding id>", "verdict": "real|false_positive|uncertain", "confidence": 0.0, "cvss": 0.0, "reason": "..." } ] }`;
}

export async function verifyFindings(findings: Finding[]): Promise<Finding[]> {
  const trusted = findings
    .filter((f) => FACTUAL.has(f.source))
    .map((f) => ({ ...f, verified: true, confidence: f.confidence ?? 0.95 }));
  const toVerify = findings.filter((f) => !FACTUAL.has(f.source));
  if (toVerify.length === 0) return trusted;

  const verdicts = new Map<string, { verdict: string; confidence: number; cvss: number; reason: string }>();
  for (const batch of chunk(toVerify, BATCH)) {
    try {
      const msg = await createMessage({
        model: VERIFY_MODEL,
        max_tokens: 4000,
        messages: [{ role: 'user', content: buildPrompt(batch) }],
      });
      const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
      const parsed = extractJson(text);
      for (const v of parsed.verdicts ?? []) {
        if (v?.id) verdicts.set(String(v.id), {
          verdict: String(v.verdict ?? 'uncertain'),
          confidence: Math.max(0, Math.min(1, Number(v.confidence) || 0)),
          cvss: Math.max(0, Math.min(10, Number(v.cvss) || 0)),
          reason: String(v.reason ?? ''),
        });
      }
    } catch (e) {
      console.warn('[soc2/verify] batch failed (keeping findings unverified):', e);
    }
  }

  const out: Finding[] = [];
  for (const f of toVerify) {
    const v = verdicts.get(f.id);
    if (!v) { out.push({ ...f, verified: false }); continue; } // model didn't rate it — keep as-is
    if (v.verdict === 'false_positive' && v.confidence >= 0.6) {
      continue; // drop confident false positives
    }
    const cvss = v.cvss > 0 ? v.cvss : f.cvss;
    const severity = v.verdict === 'uncertain'
      ? downgrade(f.severity)
      : (cvss ? severityFromCvss(cvss) : f.severity);
    out.push({
      ...f,
      verified: true,
      confidence: v.confidence,
      cvss,
      severity,
      detail: v.verdict === 'uncertain' ? `${f.detail} [needs manual review: ${v.reason}]` : f.detail,
    });
  }
  return [...trusted, ...out];
}
