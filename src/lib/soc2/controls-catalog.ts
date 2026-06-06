// ── SOC 2 Controls Catalog ─────────────────────────────────────────────────
// The organizational / process layer of a real SOC 2 readiness assessment —
// the ~70% that code scanning and live recon can NEVER see. Each control is a
// yes/partial/no/na question mapped to a Trust Service Criterion (TSC) and the
// AICPA Common Criteria (CC) / category series it belongs to.
//
// This is a self-assessment: the user answers, we score deterministically and
// turn every gap into a finding + roadmap item. No model call is required to
// score — Claude only writes the prose summary (with a deterministic fallback).

import type { TSC, Severity } from './static-checks';

export interface Control {
  id: string;            // stable slug, used as the answer key
  ref: string;           // AICPA reference, e.g. "CC6.1"
  criterion: TSC;        // which TSC this rolls up into for scoring
  question: string;      // plain-language yes/no the user answers
  why: string;           // why an auditor asks — shown as helper text
  severity: Severity;    // weight if missing (drives score + finding severity)
}

export interface ControlCategory {
  key: string;
  label: string;
  blurb: string;
  controls: Control[];
}

// Severity → scoring weight (also used to rank gaps in the roadmap).
export const CONTROL_WEIGHT: Record<Severity, number> = {
  critical: 10,
  high: 6,
  medium: 3,
  low: 1,
  info: 0,
};

export const CONTROL_CATEGORIES: ControlCategory[] = [
  {
    key: 'governance',
    label: 'Governance & control environment',
    blurb: 'CC1 · Does someone own security, with policies people actually follow?',
    controls: [
      { id: 'security-policy', ref: 'CC1.1', criterion: 'security', severity: 'high',
        question: 'Do you have written information security policies, reviewed at least annually?',
        why: 'Auditors expect documented, dated, leadership-approved policies as the baseline of every SOC 2 report.' },
      { id: 'security-owner', ref: 'CC1.2', criterion: 'security', severity: 'high',
        question: 'Is there a named person or role accountable for security (CISO, security lead, or founder)?',
        why: 'SOC 2 needs a clear owner of the control environment, not diffuse responsibility.' },
      { id: 'org-chart-roles', ref: 'CC1.3', criterion: 'security', severity: 'medium',
        question: 'Are roles, responsibilities and reporting lines documented (org chart / responsibility matrix)?',
        why: 'Demonstrates segregation of duties and that authority is assigned, not assumed.' },
      { id: 'background-checks', ref: 'CC1.4', criterion: 'security', severity: 'low',
        question: 'Do new employees go through background checks and sign confidentiality agreements?',
        why: 'Personnel screening is a standard CC1 control for workforce trustworthiness.' },
      { id: 'security-training', ref: 'CC1.4', criterion: 'security', severity: 'medium',
        question: 'Does staff complete security awareness training at hire and at least yearly?',
        why: 'Most breaches start with people; auditors look for evidence of recurring training.' },
    ],
  },
  {
    key: 'risk',
    label: 'Risk assessment',
    blurb: 'CC3 · Do you identify and rank the things that could go wrong?',
    controls: [
      { id: 'risk-assessment', ref: 'CC3.1', criterion: 'security', severity: 'high',
        question: 'Do you run a documented risk assessment at least annually?',
        why: 'CC3 requires a formal, repeatable process to identify and rate risks to the system.' },
      { id: 'risk-register', ref: 'CC3.2', criterion: 'security', severity: 'medium',
        question: 'Do you maintain a risk register with owners and remediation status?',
        why: 'Evidence that identified risks are tracked to closure, not just listed once.' },
      { id: 'fraud-risk', ref: 'CC3.3', criterion: 'integrity', severity: 'low',
        question: 'Have you considered fraud and insider-threat risks specifically?',
        why: 'CC3.3 calls out fraud risk as a distinct dimension of the assessment.' },
    ],
  },
  {
    key: 'access',
    label: 'Logical access control',
    blurb: 'CC6 · Who can get in, how, and is it provably least-privilege?',
    controls: [
      { id: 'mfa-enforced', ref: 'CC6.1', criterion: 'security', severity: 'critical',
        question: 'Is MFA enforced on all admin, production and SaaS accounts?',
        why: 'Missing MFA is the single most common SOC 2 exception and a frequent breach root cause.' },
      { id: 'access-provisioning', ref: 'CC6.2', criterion: 'security', severity: 'high',
        question: 'Is access granted through a documented request/approval process?',
        why: 'CC6.2 wants provisioning to be authorized and traceable, not ad-hoc.' },
      { id: 'access-reviews', ref: 'CC6.2', criterion: 'security', severity: 'high',
        question: 'Do you review who has access to production and key systems at least quarterly?',
        why: 'Periodic access reviews catch privilege creep and orphaned accounts.' },
      { id: 'offboarding', ref: 'CC6.3', criterion: 'security', severity: 'critical',
        question: 'Is access revoked within 24 hours when someone leaves or changes roles?',
        why: 'Lingering access for ex-staff is a high-severity finding auditors test directly.' },
      { id: 'least-privilege', ref: 'CC6.3', criterion: 'security', severity: 'medium',
        question: 'Do you apply least-privilege / role-based access rather than shared admin logins?',
        why: 'Shared credentials defeat attribution and break segregation of duties.' },
      { id: 'encryption-rest', ref: 'CC6.1', criterion: 'confidentiality', severity: 'high',
        question: 'Is sensitive data encrypted at rest (databases, backups, object storage)?',
        why: 'Encryption at rest is a baseline confidentiality control and often a customer requirement.' },
      { id: 'encryption-transit', ref: 'CC6.7', criterion: 'confidentiality', severity: 'high',
        question: 'Is all data in transit encrypted with TLS, with no plaintext channels?',
        why: 'CC6.7 requires protection of data moving across networks.' },
      { id: 'key-management', ref: 'CC6.1', criterion: 'confidentiality', severity: 'medium',
        question: 'Are encryption keys and secrets stored in a managed vault (not in code or env files in the repo)?',
        why: 'Secret sprawl is a top cause of breaches and a confidentiality red flag.' },
    ],
  },
  {
    key: 'operations',
    label: 'Monitoring & incident response',
    blurb: 'CC7 · Can you detect a problem and respond to it on a clock?',
    controls: [
      { id: 'logging', ref: 'CC7.2', criterion: 'security', severity: 'high',
        question: 'Are security-relevant events logged centrally and retained (auth, admin actions, changes)?',
        why: 'Without logs you cannot detect, investigate, or prove anything to an auditor.' },
      { id: 'monitoring-alerts', ref: 'CC7.2', criterion: 'security', severity: 'medium',
        question: 'Do you have alerting that notifies someone of anomalies or security events?',
        why: 'CC7.2 expects active monitoring, not logs nobody reads.' },
      { id: 'vuln-management', ref: 'CC7.1', criterion: 'security', severity: 'high',
        question: 'Do you scan for vulnerabilities and patch on a defined schedule?',
        why: 'Auditors test that known vulns are found and remediated within an SLA.' },
      { id: 'incident-plan', ref: 'CC7.3', criterion: 'security', severity: 'high',
        question: 'Do you have a written incident response plan with defined roles and steps?',
        why: 'CC7.3/7.4 require a documented, tested process for handling incidents.' },
      { id: 'incident-drill', ref: 'CC7.4', criterion: 'security', severity: 'low',
        question: 'Have you tested the incident plan (tabletop or real) in the last year?',
        why: 'An untested plan is treated as no plan; evidence of a drill closes the gap.' },
      { id: 'pentest', ref: 'CC7.1', criterion: 'security', severity: 'medium',
        question: 'Do you commission an independent penetration test at least annually?',
        why: 'Third-party testing is expected for the security criterion at most audit scopes.' },
    ],
  },
  {
    key: 'change',
    label: 'Change management',
    blurb: 'CC8 · Are production changes reviewed, tested and traceable?',
    controls: [
      { id: 'code-review', ref: 'CC8.1', criterion: 'integrity', severity: 'high',
        question: 'Are code changes peer-reviewed before merging to production?',
        why: 'CC8.1 wants changes authorized and reviewed; unreviewed merges are a processing-integrity gap.' },
      { id: 'branch-protection', ref: 'CC8.1', criterion: 'integrity', severity: 'medium',
        question: 'Is your main branch protected (no direct pushes, required checks)?',
        why: 'Enforces the review control technically rather than by trust.' },
      { id: 'ci-tests', ref: 'CC8.1', criterion: 'integrity', severity: 'medium',
        question: 'Do automated tests / CI run before deploys to production?',
        why: 'Demonstrates changes are validated, supporting processing integrity.' },
      { id: 'separate-environments', ref: 'CC8.1', criterion: 'integrity', severity: 'medium',
        question: 'Are development, staging and production environments separated?',
        why: 'Prevents untested changes and test data from reaching production.' },
      { id: 'rollback', ref: 'CC8.1', criterion: 'availability', severity: 'low',
        question: 'Can you roll back a bad deploy quickly (documented rollback path)?',
        why: 'Supports availability by limiting the blast radius of a faulty change.' },
    ],
  },
  {
    key: 'vendors',
    label: 'Vendor & third-party risk',
    blurb: 'CC9 · Are the services you depend on held to your standard?',
    controls: [
      { id: 'vendor-inventory', ref: 'CC9.2', criterion: 'security', severity: 'medium',
        question: 'Do you keep an inventory of vendors/subprocessors that handle your data?',
        why: 'You cannot manage third-party risk you have not enumerated.' },
      { id: 'vendor-review', ref: 'CC9.2', criterion: 'security', severity: 'medium',
        question: 'Do you review vendors’ security posture (e.g. their SOC 2) before and during use?',
        why: 'CC9.2 requires assessing the controls of parties you rely on.' },
      { id: 'dpa-signed', ref: 'CC9.2', criterion: 'privacy', severity: 'medium',
        question: 'Do you have DPAs / contracts with security and privacy terms in place with vendors?',
        why: 'Contractual controls are the enforceable layer of vendor management.' },
    ],
  },
  {
    key: 'availability',
    label: 'Availability',
    blurb: 'A1 · Can you meet your uptime commitments and recover from disaster?',
    controls: [
      { id: 'backups', ref: 'A1.2', criterion: 'availability', severity: 'high',
        question: 'Are backups automated, encrypted, and stored separately from production?',
        why: 'A1.2 requires backup of data to meet availability and recovery objectives.' },
      { id: 'backup-restore-test', ref: 'A1.3', criterion: 'availability', severity: 'medium',
        question: 'Have you tested restoring from backup in the last year?',
        why: 'An untested backup is an assumption; A1.3 wants evidence recovery works.' },
      { id: 'bcdr-plan', ref: 'A1.2', criterion: 'availability', severity: 'medium',
        question: 'Do you have a business continuity / disaster recovery plan with RTO/RPO targets?',
        why: 'Defines and demonstrates your ability to meet availability commitments.' },
      { id: 'capacity-monitoring', ref: 'A1.1', criterion: 'availability', severity: 'low',
        question: 'Do you monitor capacity / uptime against your SLAs?',
        why: 'A1.1 expects you to track that you are meeting availability commitments.' },
    ],
  },
  {
    key: 'privacy',
    label: 'Privacy & data handling',
    blurb: 'P · Do you handle personal data lawfully and only as needed?',
    controls: [
      { id: 'data-inventory', ref: 'P1.1', criterion: 'privacy', severity: 'medium',
        question: 'Do you know what personal data you collect, where it lives, and why?',
        why: 'A data inventory / map is the foundation of every privacy control.' },
      { id: 'privacy-notice', ref: 'P1.1', criterion: 'privacy', severity: 'medium',
        question: 'Do you publish a privacy notice describing collection, use and rights?',
        why: 'Transparency to data subjects is a core privacy-criterion requirement.' },
      { id: 'data-retention', ref: 'P4.2', criterion: 'privacy', severity: 'medium',
        question: 'Do you have a data retention & deletion policy that is actually enforced?',
        why: 'Holding data forever increases breach impact and violates retention principles.' },
      { id: 'data-subject-requests', ref: 'P5.1', criterion: 'privacy', severity: 'low',
        question: 'Can you fulfil access/deletion (DSAR) requests within a defined timeframe?',
        why: 'Privacy criterion and laws like GDPR/CCPA require honoring data-subject rights.' },
      { id: 'data-classification', ref: 'C1.1', criterion: 'confidentiality', severity: 'low',
        question: 'Is data classified by sensitivity, with handling rules per class?',
        why: 'Classification drives which confidentiality controls apply where.' },
    ],
  },
];

// Flat lookup for scoring.
export const ALL_CONTROLS: Control[] = CONTROL_CATEGORIES.flatMap(c => c.controls);
export const CONTROL_BY_ID: Record<string, Control> = Object.fromEntries(
  ALL_CONTROLS.map(c => [c.id, c]),
);
