// ── SOC 2 Controls Self-Assessment — scoring engine ────────────────────────
// Turns the user's yes/partial/no/na answers to the controls catalog into the
// SAME report shape the code & live engines produce, so the existing report
// page renders it unchanged. Scoring is fully deterministic (no model needed);
// Claude only writes the prose summary, with a deterministic fallback so the
// run never fails on an API hiccup.

import { createMessage } from '../anthropic';
import type { Finding, TSC, Severity } from './static-checks';
import { frameworksFor, type TaggedFinding } from './framework-map';
import {
  CONTROL_CATEGORIES,
  CONTROL_BY_ID,
  CONTROL_WEIGHT,
  type Control,
} from './controls-catalog';

const SONNET_MODEL = 'claude-sonnet-4-6';

export type Answer = 'yes' | 'partial' | 'no' | 'na';
export type Answers = Record<string, Answer>;

const TSC_KEYS: TSC[] = ['security', 'availability', 'confidentiality', 'integrity', 'privacy'];

export interface RoadmapItem {
  priority: number;
  title: string;
  detail: string;
  criterion: TSC;
  effort: 'low' | 'medium' | 'high';
}

export interface ControlsReport {
  mode: 'controls';
  summary: string;
  scores: {
    overall: number;
    security: number;
    availability: number;
    confidentiality: number;
    integrity: number;
    privacy: number;
  };
  findings: TaggedFinding[];
  roadmap: RoadmapItem[];
  coverage: {
    total: number;        // applicable controls (na excluded)
    inPlace: number;      // answered yes
    partial: number;      // answered partial
    gaps: number;         // answered no
    skipped: number;      // answered na or unanswered
    byCategory: { key: string; label: string; inPlace: number; total: number }[];
  };
  disclaimer: string;
}

const DISCLAIMER =
  'Readiness self-assessment based on your own answers. This is not a SOC 2 audit or attestation; a SOC 2 report can only be issued by a licensed CPA firm, which independently tests evidence for each control.';

function clampScore(n: number): number {
  return Math.max(0, Math.min(100, Math.round(n)));
}

// Credit earned per answer toward the criterion score.
const CREDIT: Record<Answer, number> = { yes: 1, partial: 0.5, no: 0, na: 0 };

// A 'no' keeps its control severity; a 'partial' is one tier softer.
const SOFTER: Record<Severity, Severity> = {
  critical: 'high', high: 'medium', medium: 'low', low: 'low', info: 'info',
};

const EFFORT_BY_SEVERITY: Record<Severity, 'low' | 'medium' | 'high'> = {
  critical: 'high', high: 'high', medium: 'medium', low: 'low', info: 'low',
};

const SEV_RANK: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };

function scoreCriterion(answers: Answers, criterion: TSC): number {
  const controls = CONTROL_CATEGORIES.flatMap(c => c.controls).filter(c => c.criterion === criterion);
  let earned = 0, possible = 0;
  for (const ctl of controls) {
    const ans = answers[ctl.id] ?? 'na';
    if (ans === 'na') continue;            // not applicable — excluded from the denominator
    const w = CONTROL_WEIGHT[ctl.severity];
    possible += w;
    earned += w * CREDIT[ans];
  }
  if (possible === 0) return 70;           // no applicable controls answered → neutral, like the code engine
  return clampScore((earned / possible) * 100);
}

// Each 'no' / 'partial' becomes a finding, ordered most-severe first. Findings
// carry the framework crosswalk: the SOC 2 tag is the control's exact AICPA ref,
// with ISO 27001 / NIST cross-references derived from the criterion.
function buildFindings(answers: Answers): TaggedFinding[] {
  const out: TaggedFinding[] = [];
  for (const ctl of CONTROL_CATEGORIES.flatMap(c => c.controls)) {
    const ans = answers[ctl.id];
    if (ans !== 'no' && ans !== 'partial') continue;
    const severity = ans === 'partial' ? SOFTER[ctl.severity] : ctl.severity;
    const base: Finding = {
      id: `ctl-${ctl.id}`,
      title: ctl.question.replace(/\?$/, ''),
      severity,
      criterion: ctl.criterion,
      detail: ans === 'partial'
        ? `Partially in place. ${ctl.why}`
        : `Control not in place. ${ctl.why}`,
      fix: ans === 'partial'
        ? 'Finish rolling this out consistently and document it so an auditor can test it.'
        : 'Implement this control, write it down, and keep evidence (config, tickets, logs) that it operates.',
      evidence: `${ctl.ref} · ${ctl.criterion}`,
      source: 'questionnaire',
    };
    out.push({ ...base, frameworks: { ...frameworksFor(base), soc2: [ctl.ref] } });
  }
  return out.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity]);
}

function buildRoadmap(answers: Answers): RoadmapItem[] {
  const gaps: { ctl: Control; ans: Answer }[] = [];
  for (const ctl of CONTROL_CATEGORIES.flatMap(c => c.controls)) {
    const ans = answers[ctl.id];
    if (ans === 'no' || ans === 'partial') gaps.push({ ctl, ans });
  }
  // Worst first: 'no' before 'partial', then by control weight.
  gaps.sort((a, b) => {
    if (a.ans !== b.ans) return a.ans === 'no' ? -1 : 1;
    return CONTROL_WEIGHT[b.ctl.severity] - CONTROL_WEIGHT[a.ctl.severity];
  });
  return gaps.slice(0, 8).map((g, i) => ({
    priority: i + 1,
    title: g.ctl.question.replace(/\?$/, ''),
    detail: g.ctl.why,
    criterion: g.ctl.criterion,
    effort: EFFORT_BY_SEVERITY[g.ctl.severity],
  }));
}

function buildCoverage(answers: Answers): ControlsReport['coverage'] {
  let inPlace = 0, partial = 0, gaps = 0, skipped = 0, total = 0;
  const byCategory = CONTROL_CATEGORIES.map(cat => {
    let cIn = 0, cTotal = 0;
    for (const ctl of cat.controls) {
      const ans = answers[ctl.id] ?? 'na';
      if (ans === 'na') { skipped++; continue; }
      cTotal++; total++;
      if (ans === 'yes') { inPlace++; cIn++; }
      else if (ans === 'partial') partial++;
      else gaps++;
    }
    return { key: cat.key, label: cat.label, inPlace: cIn, total: cTotal };
  });
  return { total, inPlace, partial, gaps, skipped, byCategory };
}

async function writeSummary(scores: ControlsReport['scores'], coverage: ControlsReport['coverage'], findings: Finding[]): Promise<string> {
  const fallback =
    `${coverage.inPlace} of ${coverage.total} applicable controls are in place (overall readiness ${scores.overall}/100). ` +
    (findings.length
      ? `${findings.length} gap${findings.length === 1 ? '' : 's'} to close before an audit, starting with the highest-severity items in the roadmap.`
      : `No gaps were reported — focus next on collecting evidence that each control operates over time.`);

  const topGaps = findings.slice(0, 8).map(f => `- [${f.severity}] ${f.title} (${f.criterion})`).join('\n') || '(none)';
  try {
    const msg = await createMessage({
      model: SONNET_MODEL,
      max_tokens: 320,
      messages: [{
        role: 'user',
        content:
          `You are a SOC 2 readiness assessor. A founder self-assessed their controls. ` +
          `Overall readiness ${scores.overall}/100. Per criterion: security ${scores.security}, availability ${scores.availability}, confidentiality ${scores.confidentiality}, processing integrity ${scores.integrity}, privacy ${scores.privacy}. ` +
          `${coverage.inPlace}/${coverage.total} applicable controls in place, ${coverage.partial} partial, ${coverage.gaps} missing.\n` +
          `Top gaps:\n${topGaps}\n\n` +
          `Write a 2-3 sentence, plain, encouraging-but-honest readiness summary. No markdown, no lists, no preamble. Do not use em dashes.`,
      }],
    });
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
    return text || fallback;
  } catch {
    return fallback;
  }
}

export async function runControlsAudit(answers: Answers): Promise<ControlsReport> {
  const scoresByTsc = Object.fromEntries(
    TSC_KEYS.map(k => [k, scoreCriterion(answers, k)]),
  ) as Record<TSC, number>;

  // Same weighting the code engine uses — security dominates.
  const overall = clampScore(
    scoresByTsc.security * 0.4 +
    scoresByTsc.confidentiality * 0.2 +
    scoresByTsc.integrity * 0.15 +
    scoresByTsc.availability * 0.15 +
    scoresByTsc.privacy * 0.1,
  );

  const findings = buildFindings(answers);
  const roadmap = buildRoadmap(answers);
  const coverage = buildCoverage(answers);
  const summary = await writeSummary({ overall, ...scoresByTsc }, coverage, findings);

  return {
    mode: 'controls',
    summary,
    scores: { overall, ...scoresByTsc },
    findings,
    roadmap,
    coverage,
    disclaimer: DISCLAIMER,
  };
}

// Re-export the catalog so callers (endpoint, page) have one import surface.
export { CONTROL_CATEGORIES, CONTROL_BY_ID } from './controls-catalog';
