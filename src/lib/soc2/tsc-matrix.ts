// ── SOC 2 Trust Services Criteria completeness matrix ──────────────────────
// A score is only meaningful if it maps to the actual criteria. This builds a
// per-TSC matrix: how many controls roll into each criterion, how the findings
// and evidence distribute across them, and a coverage % per criterion. It gives
// the report an auditor-style "where are we strong / where are the gaps" view.

import { CONTROL_CATEGORIES } from './controls-catalog';
import type { Finding, TSC, Severity } from './static-checks';
import type { EvidenceItem } from './evidence';

const TSC_ORDER: TSC[] = ['security', 'availability', 'confidentiality', 'integrity', 'privacy'];
const TSC_LABEL: Record<TSC, string> = {
  security: 'Security (Common Criteria)',
  availability: 'Availability',
  confidentiality: 'Confidentiality',
  integrity: 'Processing Integrity',
  privacy: 'Privacy',
};
const PENALTY: Record<Severity, number> = { critical: 28, high: 16, medium: 7, low: 2, info: 0 };

export interface TscRow {
  criterion: TSC;
  label: string;
  totalControls: number;
  findings: number;
  criticalHigh: number;
  evidencePresent: number;
  evidenceAbsent: number;
  coverage: number; // 0..100
}
export interface TscMatrix {
  rows: TscRow[];
  overallCoverage: number;
  controlRefToCriterion: Record<string, TSC>;
}

function controlRefMap(): Record<string, TSC> {
  const map: Record<string, TSC> = {};
  for (const cat of CONTROL_CATEGORIES) {
    for (const c of cat.controls) {
      // first criterion wins for a given ref; refs can repeat across criteria
      if (!map[c.ref]) map[c.ref] = c.criterion;
    }
  }
  return map;
}

export function buildTscMatrix(findings: Finding[], evidence: EvidenceItem[] = []): TscMatrix {
  const refMap = controlRefMap();

  const totalByCrit: Record<TSC, number> = { security: 0, availability: 0, confidentiality: 0, integrity: 0, privacy: 0 };
  for (const cat of CONTROL_CATEGORIES) for (const c of cat.controls) totalByCrit[c.criterion]++;

  const rows: TscRow[] = TSC_ORDER.map((criterion) => {
    const crit = findings.filter((f) => f.criterion === criterion);
    const present = evidence.filter((e) => (refMap[e.control] ?? 'security') === criterion && e.status === 'present').length;
    const absent = evidence.filter((e) => (refMap[e.control] ?? 'security') === criterion && e.status === 'absent').length;
    const penalty = crit.reduce((s, f) => s + (PENALTY[f.severity] ?? 0), 0) + absent * 6;
    return {
      criterion,
      label: TSC_LABEL[criterion],
      totalControls: totalByCrit[criterion],
      findings: crit.length,
      criticalHigh: crit.filter((f) => f.severity === 'critical' || f.severity === 'high').length,
      evidencePresent: present,
      evidenceAbsent: absent,
      coverage: Math.max(0, Math.min(100, Math.round(100 - penalty))),
    };
  });

  // Security weighted heaviest (required TSC), same weighting as the engines.
  const w: Record<TSC, number> = { security: 0.4, confidentiality: 0.2, integrity: 0.15, availability: 0.15, privacy: 0.1 };
  const overallCoverage = Math.round(rows.reduce((s, r) => s + r.coverage * w[r.criterion], 0));

  return { rows, overallCoverage, controlRefToCriterion: refMap };
}
