// ── SOC 2 policy & process artifact generation ─────────────────────────────
// SOC 2 is ~50% written controls (policies, registers, plans) that auditors
// expect to exist. The old tool only *flagged* these as missing. This module
// GENERATES tailored, editable drafts of the whole policy pack plus a risk
// register, incident-response runbook, and System Description, grounded in the
// org's actual stack so they're real starting points, not boilerplate.

import { createMessage } from '../anthropic';

const POLICY_MODEL = 'claude-sonnet-4-6';
const CONCURRENCY = 4;

export interface PolicyDoc {
  id: string;
  title: string;
  control: string;     // primary SOC 2 control it satisfies
  markdown: string;
}

export interface PolicyPack {
  company: string;
  policies: PolicyDoc[];
  riskRegister: string;        // markdown table
  systemDescription: string;   // markdown
  generatedAt: string;
}

export interface PolicyContext {
  company: string;
  stack?: string;              // e.g. "Astro on Vercel, Neon Postgres, Better-Auth, GitHub, Stripe"
  findingsSummary?: string;    // short list of top findings to seed the risk register
}

// The SOC 2-relevant written policies an auditor expects for the Security TSC.
const CATALOG: { id: string; title: string; control: string; scope: string }[] = [
  { id: 'infosec', title: 'Information Security Policy', control: 'CC1.1', scope: 'the overarching security program, roles, and management commitment' },
  { id: 'access-control', title: 'Access Control Policy', control: 'CC6.1', scope: 'provisioning, least privilege, MFA, periodic access reviews, deprovisioning' },
  { id: 'acceptable-use', title: 'Acceptable Use Policy', control: 'CC1.4', scope: 'acceptable use of company systems, data, and devices' },
  { id: 'change-management', title: 'Change Management Policy', control: 'CC8.1', scope: 'code review, branch protection, testing, approvals, and release process' },
  { id: 'incident-response', title: 'Incident Response Policy', control: 'CC7.3', scope: 'detection, triage, escalation, containment, notification, and post-mortems' },
  { id: 'risk-assessment', title: 'Risk Assessment Policy', control: 'CC3.1', scope: 'how risks are identified, scored, treated, and reviewed' },
  { id: 'vendor-management', title: 'Vendor / Third-Party Management Policy', control: 'CC9.2', scope: 'vendor due diligence, DPAs, and ongoing review of subprocessors' },
  { id: 'data-classification', title: 'Data Classification & Handling Policy', control: 'CC6.7', scope: 'data classes, handling rules, and encryption requirements' },
  { id: 'encryption', title: 'Encryption & Key Management Policy', control: 'CC6.7', scope: 'encryption in transit/at rest and secret/key management' },
  { id: 'bcdr', title: 'Business Continuity & Disaster Recovery Policy', control: 'A1.2', scope: 'backups, RTO/RPO, failover, and recovery testing' },
  { id: 'logging-monitoring', title: 'Logging & Monitoring Policy', control: 'CC7.2', scope: 'what is logged, retention, alerting, and review' },
  { id: 'sdlc', title: 'Secure SDLC Policy', control: 'CC8.1', scope: 'secure development, dependency management, and security testing in CI' },
  { id: 'vuln-management', title: 'Vulnerability Management Policy', control: 'CC7.1', scope: 'scanning, patch SLAs by severity, and remediation tracking' },
  { id: 'data-retention', title: 'Data Retention & Deletion Policy', control: 'C1.2', scope: 'retention periods and secure deletion / DSAR handling' },
  { id: 'business-ethics', title: 'Code of Conduct', control: 'CC1.1', scope: 'expected ethical conduct of personnel' },
  { id: 'privacy', title: 'Privacy Policy (internal handling)', control: 'P1.1', scope: 'how personal data is collected, used, and protected' },
];

async function genOne(p: { id: string; title: string; control: string; scope: string }, ctx: PolicyContext): Promise<PolicyDoc> {
  const prompt = `Write a concise, audit-ready "${p.title}" for the company "${ctx.company}".
Stack/context: ${ctx.stack || 'a modern SaaS web application'}.
Scope: ${p.scope}. It must support SOC 2 control ${p.control}.

Requirements:
- Real, specific, and tailored to the stack above — NOT generic filler. Where a concrete tool is known (e.g. GitHub branch protection, Vercel, Neon, Better-Auth, Stripe), reference it by name.
- Sections: Purpose, Scope, Policy (numbered, concrete requirements), Roles & Responsibilities, Enforcement, Review cadence.
- Leave clearly-marked [PLACEHOLDER] tokens only where a human MUST fill a specific value (e.g. [Security Officer name], [retention period]).
- 350–600 words. Markdown. No preamble — start with the H1 title.`;
  const msg = await createMessage({ model: POLICY_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
  const markdown = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
  return { id: p.id, title: p.title, control: p.control, markdown };
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx]); }
  }));
  return out;
}

async function genRiskRegister(ctx: PolicyContext): Promise<string> {
  const prompt = `Produce a starter SOC 2 risk register for "${ctx.company}" (${ctx.stack || 'SaaS web app'}) as a markdown table with columns: ID, Risk, Category, Likelihood (L/M/H), Impact (L/M/H), Inherent score, Treatment, Owner, Status.
Seed it from these observed issues where relevant:
${ctx.findingsSummary || '(no scan findings provided — use the most common risks for this stack)'}
Include 10–15 realistic rows covering access, change management, vendors, availability, data protection, and vulnerability management. Markdown table only, no preamble.`;
  const msg = await createMessage({ model: POLICY_MODEL, max_tokens: 2500, messages: [{ role: 'user', content: prompt }] });
  return msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
}

async function genSystemDescription(ctx: PolicyContext): Promise<string> {
  const prompt = `Write a SOC 2 "System Description" skeleton for "${ctx.company}" (${ctx.stack || 'SaaS web app'}). Sections: Company overview & services, System boundaries, Infrastructure & software, People (roles), Data (types & flows), Subservice organizations (vendors), and the relevant Trust Services Criteria. Use [PLACEHOLDER] where specifics are required. ~500 words, markdown, start with the H1.`;
  const msg = await createMessage({ model: POLICY_MODEL, max_tokens: 2000, messages: [{ role: 'user', content: prompt }] });
  return msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('').trim();
}

export async function generatePolicyPack(ctx: PolicyContext, opts: { only?: string[] } = {}): Promise<PolicyPack> {
  const catalog = opts.only ? CATALOG.filter((p) => opts.only!.includes(p.id)) : CATALOG;
  const [policies, riskRegister, systemDescription] = await Promise.all([
    mapLimit(catalog, CONCURRENCY, (p) => genOne(p, ctx)),
    genRiskRegister(ctx),
    genSystemDescription(ctx),
  ]);
  return { company: ctx.company, policies, riskRegister, systemDescription, generatedAt: new Date().toISOString() };
}

export const POLICY_CATALOG = CATALOG;
