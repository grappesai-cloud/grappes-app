// ── SOC 2 Code Audit — orchestrator ────────────────────────────────────────
// Static pre-pass (cheap, deterministic) + Claude holistic review, merged into
// one report scored against the five Trust Service Criteria (TSC).
// This is a READINESS assessment, never an attestation.

import { createMessage } from '../anthropic';
import { runStaticChecks, type CodeFile, type Finding, type TSC, type Severity } from './static-checks';

const SONNET_MODEL = 'claude-sonnet-4-6';

// Cap total code sent to the model so a huge paste stays within budget.
const MAX_TOTAL_CHARS = 120_000;

export const TSC_LABELS: Record<TSC, string> = {
  security: 'Security',
  availability: 'Availability',
  confidentiality: 'Confidentiality',
  integrity: 'Processing Integrity',
  privacy: 'Privacy',
};

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25,
  high: 15,
  medium: 8,
  low: 3,
  info: 0,
};

export interface RoadmapItem {
  priority: number;       // 1 = do first
  title: string;
  detail: string;
  criterion: TSC;
  effort: 'low' | 'medium' | 'high';
}

export interface CodeAuditReport {
  mode: 'code';
  summary: string;
  scores: {
    overall: number;
    security: number;
    availability: number;
    confidentiality: number;
    integrity: number;
    privacy: number;
  };
  findings: Finding[];
  roadmap: RoadmapItem[];
  stats: { filesScanned: number; linesScanned: number };
  disclaimer: string;
}

const DISCLAIMER =
  'Readiness assessment only. This is not a SOC 2 audit or attestation; a SOC 2 report can only be issued by a licensed CPA firm.';

function clampScore(n: unknown): number {
  const v = typeof n === 'number' ? n : 50;
  return Math.max(0, Math.min(100, Math.round(v)));
}

// Trim the code corpus to a budget, keeping whole files where possible.
function packFiles(files: CodeFile[]): { packed: string; used: CodeFile[] } {
  let budget = MAX_TOTAL_CHARS;
  const used: CodeFile[] = [];
  const parts: string[] = [];
  for (const f of files) {
    if (budget <= 0) break;
    const content = f.content.length > budget ? f.content.slice(0, budget) + '\n…[truncated]' : f.content;
    budget -= content.length;
    used.push(f);
    parts.push(`### FILE: ${f.path}\n\`\`\`\n${content}\n\`\`\``);
  }
  return { packed: parts.join('\n\n'), used };
}

function buildPrompt(packed: string, staticFindings: Finding[]): string {
  const staticSummary = staticFindings.length
    ? staticFindings.map(f => `- [${f.severity}] ${f.title} (${f.criterion}) ${f.evidence ?? ''}`).join('\n')
    : '(none)';

  return `You are a SOC 2 readiness assessor reviewing source code. Map issues to the five Trust Service Criteria (TSC): security, availability, confidentiality, integrity (Processing Integrity), privacy.

A deterministic static scanner already flagged these (do NOT repeat them, but factor them into scoring):
${staticSummary}

Review the code below for SOC 2-relevant control gaps the scanner cannot see: authentication & authorization (access control, IDOR, missing authz checks), encryption at rest/in transit, audit logging (does it exist? does it log secrets/PII?), input validation, error handling & information disclosure, dependency/supply-chain risk, data retention & PII handling, availability (timeouts, retries, rate limiting, graceful failure).

Return ONLY valid JSON, no markdown fences, with this exact shape:
{
  "summary": "2-3 sentence plain-language readiness summary",
  "scores": { "security": 0-100, "availability": 0-100, "confidentiality": 0-100, "integrity": 0-100, "privacy": 0-100 },
  "findings": [
    { "title": "...", "severity": "critical|high|medium|low|info", "criterion": "security|availability|confidentiality|integrity|privacy", "detail": "what's wrong and why it matters for SOC 2", "fix": "concrete remediation", "evidence": "file:line or short reference" }
  ],
  "roadmap": [
    { "priority": 1, "title": "...", "detail": "...", "criterion": "security|availability|confidentiality|integrity|privacy", "effort": "low|medium|high" }
  ]
}
Score each criterion: 100 = no gaps observed, lower as gaps accumulate by severity. If a criterion isn't observable in the provided code, score it 70 and note that in a finding. Order roadmap by priority (1 first), max 8 items.
Be CONCISE to stay within the response limit: keep each "detail" to 1-2 sentences and each "fix" to 1-2 sentences. Report the most important findings first, at most 12 findings total.

CODE:
${packed}`;
}

function extractJson(text: string): any {
  // Be forgiving: strip fences, grab the outermost object.
  const cleaned = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
  const start = cleaned.indexOf('{');
  if (start === -1) throw new Error('Model returned no JSON object');
  const body = cleaned.slice(start);

  // Happy path: the response is complete.
  const lastClose = body.lastIndexOf('}');
  if (lastClose !== -1) {
    try { return JSON.parse(body.slice(0, lastClose + 1)); } catch { /* fall through to repair */ }
  }

  // Repair path: the response was truncated at max_tokens mid-array. Cut at the
  // last complete object boundary, then close any still-open arrays/objects so
  // we keep every finding the model managed to emit instead of failing the run.
  if (lastClose === -1) throw new Error('Model returned no parseable JSON');
  const truncated = body.slice(0, lastClose + 1);
  const stack: string[] = [];
  let inStr = false, esc = false;
  for (let i = 0; i < truncated.length; i++) {
    const c = truncated[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === '\\') esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === '{' || c === '[') stack.push(c);
    else if (c === '}' || c === ']') stack.pop();
  }
  let suffix = '';
  for (let i = stack.length - 1; i >= 0; i--) suffix += stack[i] === '{' ? '}' : ']';
  return JSON.parse(truncated + suffix);
}

// Derive a 0-100 criterion score from findings if the model omitted/garbled it.
function deriveScore(findings: Finding[], criterion: TSC): number {
  const penalty = findings
    .filter(f => f.criterion === criterion)
    .reduce((sum, f) => sum + (SEVERITY_WEIGHT[f.severity] ?? 0), 0);
  return clampScore(100 - penalty);
}

export async function runCodeAudit(files: CodeFile[]): Promise<CodeAuditReport> {
  if (!files.length) throw new Error('No code provided');

  const { packed, used } = packFiles(files);
  const staticResult = runStaticChecks(used);

  const msg = await createMessage({
    model: SONNET_MODEL,
    max_tokens: 8000,
    messages: [{ role: 'user', content: buildPrompt(packed, staticResult.findings) }],
  });

  const text = msg.content
    .filter((b: any) => b.type === 'text')
    .map((b: any) => b.text)
    .join('');

  const parsed = extractJson(text);

  const aiFindings: Finding[] = Array.isArray(parsed.findings)
    ? parsed.findings.map((f: any) => ({
        id: 'ai-' + String(f.title ?? 'finding').toLowerCase().replace(/[^a-z0-9]+/g, '-').slice(0, 40),
        title: String(f.title ?? 'Finding'),
        severity: (['critical', 'high', 'medium', 'low', 'info'].includes(f.severity) ? f.severity : 'medium') as Severity,
        criterion: (['security', 'availability', 'confidentiality', 'integrity', 'privacy'].includes(f.criterion) ? f.criterion : 'security') as TSC,
        detail: String(f.detail ?? ''),
        fix: String(f.fix ?? ''),
        evidence: f.evidence ? String(f.evidence) : undefined,
        source: 'ai' as const,
      }))
    : [];

  // Static findings first (they're concrete), then AI findings.
  const findings = [...staticResult.findings, ...aiFindings];

  const s = parsed.scores ?? {};
  const scores = {
    security: typeof s.security === 'number' ? clampScore(s.security) : deriveScore(findings, 'security'),
    availability: typeof s.availability === 'number' ? clampScore(s.availability) : deriveScore(findings, 'availability'),
    confidentiality: typeof s.confidentiality === 'number' ? clampScore(s.confidentiality) : deriveScore(findings, 'confidentiality'),
    integrity: typeof s.integrity === 'number' ? clampScore(s.integrity) : deriveScore(findings, 'integrity'),
    privacy: typeof s.privacy === 'number' ? clampScore(s.privacy) : deriveScore(findings, 'privacy'),
  };

  // Security is weighted heaviest — it's the one required TSC for every SOC 2 report.
  const overall = clampScore(
    scores.security * 0.4 +
      scores.confidentiality * 0.2 +
      scores.integrity * 0.15 +
      scores.availability * 0.15 +
      scores.privacy * 0.1,
  );

  const roadmap: RoadmapItem[] = Array.isArray(parsed.roadmap)
    ? parsed.roadmap.slice(0, 8).map((r: any, i: number) => ({
        priority: typeof r.priority === 'number' ? r.priority : i + 1,
        title: String(r.title ?? ''),
        detail: String(r.detail ?? ''),
        criterion: (['security', 'availability', 'confidentiality', 'integrity', 'privacy'].includes(r.criterion) ? r.criterion : 'security') as TSC,
        effort: (['low', 'medium', 'high'].includes(r.effort) ? r.effort : 'medium') as 'low' | 'medium' | 'high',
      }))
    : [];

  return {
    mode: 'code',
    summary: String(parsed.summary ?? 'Readiness review complete.'),
    scores: { overall, ...scores },
    findings,
    roadmap,
    stats: { filesScanned: staticResult.filesScanned, linesScanned: staticResult.linesScanned },
    disclaimer: DISCLAIMER,
  };
}
