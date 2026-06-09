// ── Multi-framework mapping (Phase 0.4) ────────────────────────────────────
// A single finding maps to more than one compliance framework. We already score
// against the five SOC 2 Trust Service Criteria (TSC); this module adds the
// crosswalk to ISO 27001:2022 Annex A and NIST SP 800-53 Rev. 5 so every report
// can tag findings across all three. The mapping is deliberately COARSE and
// honest: a default per-TSC mapping, with per-finding-id overrides for the
// high-signal cases. It is guidance for a readiness review, not a certified
// crosswalk.

import type { TSC, Finding } from './static-checks';

export interface FrameworkTags {
  // SOC 2 — the common-criteria / TSC reference(s)
  soc2: string[];
  // ISO/IEC 27001:2022 Annex A control reference(s)
  iso27001: string[];
  // NIST SP 800-53 Rev. 5 control family/reference(s)
  nist80053: string[];
}

// Default crosswalk keyed by Trust Service Criterion. These are the broad,
// always-applicable references for each criterion.
const BY_CRITERION: Record<TSC, FrameworkTags> = {
  security: {
    soc2: ['CC6.1', 'CC6.6', 'CC7.1'],
    iso27001: ['A.5.15', 'A.8.2', 'A.8.16'],
    nist80053: ['AC-3', 'SI-4', 'RA-5'],
  },
  availability: {
    soc2: ['A1.1', 'A1.2'],
    iso27001: ['A.5.30', 'A.8.6', 'A.8.14'],
    nist80053: ['CP-2', 'CP-10', 'SC-5'],
  },
  confidentiality: {
    soc2: ['C1.1', 'C1.2', 'CC6.7'],
    iso27001: ['A.8.10', 'A.8.12', 'A.8.24'],
    nist80053: ['SC-12', 'SC-13', 'SC-28'],
  },
  integrity: {
    // Processing Integrity
    soc2: ['PI1.1', 'PI1.4', 'CC8.1'],
    iso27001: ['A.8.25', 'A.8.28', 'A.8.32'],
    nist80053: ['SI-7', 'SI-10', 'CM-3'],
  },
  privacy: {
    soc2: ['P1.1', 'P4.1', 'P6.1'],
    iso27001: ['A.5.34', 'A.8.11'],
    nist80053: ['PT-2', 'PT-3', 'SI-12'],
  },
};

// Per-finding-id overrides — when a finding is specific enough to point at exact
// controls. Keys match Finding.id slugs (static-checks rule ids + mcp-checks).
const BY_FINDING_ID: Record<string, FrameworkTags> = {
  'hardcoded-secret-assignment': {
    soc2: ['CC6.1', 'CC6.3'],
    iso27001: ['A.5.17', 'A.8.24'],
    nist80053: ['IA-5', 'SC-12'],
  },
  'aws-access-key': {
    soc2: ['CC6.1', 'CC6.3'],
    iso27001: ['A.5.17'],
    nist80053: ['IA-5'],
  },
  'private-key-block': {
    soc2: ['CC6.1', 'CC6.3'],
    iso27001: ['A.5.17', 'A.8.24'],
    nist80053: ['IA-5', 'SC-12'],
  },
  'plaintext-http': {
    soc2: ['CC6.7'],
    iso27001: ['A.8.24'],
    nist80053: ['SC-8'],
  },
  'tls-verify-disabled': {
    soc2: ['CC6.7'],
    iso27001: ['A.8.24'],
    nist80053: ['SC-8', 'SC-23'],
  },
  'sql-string-concat': {
    soc2: ['CC6.1', 'PI1.1'],
    iso27001: ['A.8.28'],
    nist80053: ['SI-10'],
  },
  // ── MCP / agent-security finding ids (see mcp-checks.ts) ──
  'mcp-tool-poisoning': {
    soc2: ['CC6.1', 'CC6.8'],
    iso27001: ['A.5.23', 'A.8.28'],
    nist80053: ['SI-10', 'SA-15'],
  },
  'mcp-prompt-injection-desc': {
    soc2: ['CC6.8'],
    iso27001: ['A.8.28'],
    nist80053: ['SI-10'],
  },
  'mcp-credential-exposure': {
    soc2: ['CC6.1', 'CC6.3'],
    iso27001: ['A.5.17', 'A.8.24'],
    nist80053: ['IA-5', 'SC-12'],
  },
  'mcp-unpinned-server': {
    soc2: ['CC6.8', 'CC9.2'],
    iso27001: ['A.5.23', 'A.8.30'],
    nist80053: ['SA-12', 'CM-7'],
  },
  'mcp-untrusted-source': {
    soc2: ['CC9.2'],
    iso27001: ['A.5.19', 'A.5.21'],
    nist80053: ['SA-12', 'SR-3'],
  },
  'mcp-plaintext-transport': {
    soc2: ['CC6.7'],
    iso27001: ['A.8.24'],
    nist80053: ['SC-8'],
  },
  'mcp-excessive-permissions': {
    soc2: ['CC6.3'],
    iso27001: ['A.8.2', 'A.8.18'],
    nist80053: ['AC-6'],
  },
  'mcp-shared-privilege': {
    soc2: ['CC6.3'],
    iso27001: ['A.8.2'],
    nist80053: ['AC-6', 'AC-4'],
  },
  'mcp-no-auth-remote': {
    soc2: ['CC6.1'],
    iso27001: ['A.8.5'],
    nist80053: ['IA-2', 'AC-3'],
  },
};

// Resolve the framework tags for a finding: an id-specific override if we have
// one, otherwise the criterion default.
export function frameworksFor(finding: Pick<Finding, 'id' | 'criterion'>): FrameworkTags {
  return BY_FINDING_ID[finding.id] ?? BY_CRITERION[finding.criterion];
}

// Attach a `frameworks` field to a finding (non-destructive).
export interface TaggedFinding extends Finding {
  frameworks: FrameworkTags;
}

export function tagFindings(findings: Finding[]): TaggedFinding[] {
  return findings.map(f => ({ ...f, frameworks: frameworksFor(f) }));
}
