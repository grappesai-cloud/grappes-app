// ── Korbee SOC 2 Lab — full audit runner ───────────────────────────────────
// Runs the grappes-app SOC 2 engines against the korbee.app source tree.
// Owner (Alexandru) authorized all scans. Readiness assessment only — NOT an
// attestation.
//
// Order matters: load dotenv into process.env BEFORE importing any soc2 module,
// because lib/anthropic.ts instantiates the Anthropic client at module-init
// time using e('ANTHROPIC_API_KEY') (which falls back to process.env under tsx).

import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const GRAPPES = '/Users/alexandrucojanu/grappes-app';
const KORBEE = '/Users/alexandrucojanu/Desktop/korbee';
const SOC2 = `${GRAPPES}/src/lib/soc2`;

// 1) Load env from grappes-app/.env into process.env.
const dotenv = await import('dotenv');
dotenv.config({ path: `${GRAPPES}/.env`, override: false });
if (!process.env.ANTHROPIC_API_KEY) {
  console.error('FATAL: ANTHROPIC_API_KEY not loaded from grappes .env');
  process.exit(1);
}
console.error(`[env] ANTHROPIC_API_KEY loaded (${process.env.ANTHROPIC_API_KEY.slice(0, 8)}…)`);
console.error(`[env] DATABASE_URL ${process.env.DATABASE_URL ? 'present' : 'absent'}`);

// 2) Curated, security-ordered korbee source set. The code-audit packer keeps
//    whole files in order until its 120k-char budget is exhausted, so the
//    highest-signal files (config, auth, authz, middleware, sensitive routes)
//    come first.
const FILE_LIST: string[] = [
  // ── Config / infra ──
  'package.json',
  'astro.config.mjs',
  'vercel.json',
  'drizzle.config.ts',
  '.env.example',
  'src/env.ts',
  'src/db/index.ts',
  // ── Auth, session, authorization, middleware ──
  'src/middleware.ts',
  'src/server/auth/index.ts',
  'src/server/auth/require.ts',
  'src/server/auth/sessions.ts',
  'src/server/authorize.ts',
  'src/lib/session.ts',
  'src/lib/permissions.ts',
  'src/lib/module-gate.ts',
  'src/lib/auth-client.ts',
  // ── Core server helpers ──
  'src/server/api-response.ts',
  'src/server/rate-limit.ts',
  'src/lib/logger.ts',
  'src/lib/fetch-with-timeout.ts',
  // ── Sensitive endpoints + their services ──
  'src/pages/api/stripe/webhook.ts',
  'src/server/stripe/index.ts',
  'src/server/stripe/service.ts',
  'src/pages/api/cron/cleanup.ts',
  'src/pages/api/cron/task-reminders.ts',
  'src/server/cron/cleanup.ts',
  'src/pages/api/account/export.ts',
  'src/pages/api/account/delete.ts',
  'src/pages/api/account/sessions.ts',
  'src/pages/api/account/sessions/[id].ts',
  'src/server/account/service.ts',
  'src/pages/api/calendar/feed/[token].ts',
  'src/server/calendar/ical.ts',
  'src/pages/api/calendar/token.ts',
  'src/server/share/service.ts',
  'src/pages/api/projects/[id]/share.ts',
  'src/pages/api/invites/accept.ts',
  'src/pages/api/invites/index.ts',
  'src/server/invites/service.ts',
  'src/pages/api/inbound/booking.ts',
  'src/server/inbound/booking.ts',
  'src/pages/api/admin/users/[id].ts',
  'src/pages/api/admin/email-test.ts',
  'src/server/admin/service.ts',
  'src/server/audit/service.ts',
  'src/server/audit/user.ts',
  'src/pages/api/content/upload.ts',
  'src/pages/api/contracts/upload.ts',
  'src/server/files/service.ts',
  'src/pages/api/search.ts',
  'src/server/search/service.ts',
  'src/pages/api/auth/[...all].ts',
  // ── AI endpoints (prompt-injection surface) ──
  'src/server/ai/index.ts',
  'src/server/ai/outreach.ts',
  'src/server/ai/contract-review.ts',
  'src/server/ai/finance-query.ts',
  'src/server/ai/receipt.ts',
  'src/pages/api/ai/outreach.ts',
  'src/pages/api/ai/contract-review.ts',
  // ── Email ──
  'src/server/email/index.ts',
  'src/server/email/templates.ts',
  // ── Representative CRUD (pattern consistency) ──
  'src/pages/api/tasks/index.ts',
  'src/pages/api/tasks/[id].ts',
  'src/server/tasks/service.ts',
  'src/pages/api/transactions/index.ts',
  'src/pages/api/transactions/import.ts',
  'src/server/transactions/service.ts',
  'src/pages/api/contacts/index.ts',
  'src/pages/api/contacts/import.ts',
  'src/server/contacts/service.ts',
  'src/pages/api/profile/public.ts',
  'src/server/profile/service.ts',
  'src/pages/a/[slug].astro',
  'src/pages/share/[token].astro',
];

type CodeFile = { path: string; content: string };
const files: CodeFile[] = [];
let totalChars = 0;
const missing: string[] = [];
for (const rel of FILE_LIST) {
  const abs = join(KORBEE, rel);
  if (!existsSync(abs)) { missing.push(rel); continue; }
  try {
    const content = readFileSync(abs, 'utf8');
    files.push({ path: rel, content });
    totalChars += content.length;
  } catch {
    missing.push(rel);
  }
}
console.error(`[code] gathered ${files.length} files, ${totalChars} chars total (${missing.length} missing/skipped)`);
if (missing.length) console.error(`[code] missing: ${missing.join(', ')}`);

// 3) MCP discovery — record what we searched for. korbee has NO MCP manifest
//    (no mcp.json / claude.json / .mcp.json / .cursor; .claude/settings.local.json
//    holds only Claude Code permissions, no mcpServers). Mode 3 is therefore
//    skipped, but we record the negative result.
const MCP_CANDIDATES = [
  'mcp.json', '.mcp.json', 'claude.json', '.claude.json',
  '.cursor/mcp.json', '.vscode/mcp.json', '.claude/mcp.json',
  'claude_desktop_config.json',
];
const mcpFound = MCP_CANDIDATES.filter((c) => existsSync(join(KORBEE, c)));
let mcpSettingsHasServers = false;
const settingsPath = join(KORBEE, '.claude/settings.local.json');
if (existsSync(settingsPath)) {
  try {
    const s = JSON.parse(readFileSync(settingsPath, 'utf8'));
    mcpSettingsHasServers = !!(s.mcpServers && Object.keys(s.mcpServers).length);
  } catch { /* ignore */ }
}
console.error(`[mcp] manifest files found: ${mcpFound.length ? mcpFound.join(', ') : 'none'}; settings.mcpServers: ${mcpSettingsHasServers}`);

// 4) Controls self-assessment answers — grounded in code evidence. yes / partial
//    / no / na. Honest where the repo cannot show an organizational process.
const answers: Record<string, 'yes' | 'partial' | 'no' | 'na'> = {
  // governance (CC1)
  'security-policy': 'no',
  'security-owner': 'yes',
  'org-chart-roles': 'no',
  'background-checks': 'na',
  'security-training': 'na',
  // risk (CC3)
  'risk-assessment': 'no',
  'risk-register': 'no',
  'fraud-risk': 'no',
  // access (CC6)
  'mfa-enforced': 'partial',
  'access-provisioning': 'no',
  'access-reviews': 'no',
  'offboarding': 'partial',
  'least-privilege': 'yes',
  'encryption-rest': 'yes',
  'encryption-transit': 'yes',
  'key-management': 'yes',
  // operations (CC7)
  'logging': 'partial',
  'monitoring-alerts': 'partial',
  'vuln-management': 'partial',
  'incident-plan': 'no',
  'incident-drill': 'no',
  'pentest': 'yes',
  // change (CC8)
  'code-review': 'no',
  'branch-protection': 'no',
  'ci-tests': 'partial',
  'separate-environments': 'yes',
  'rollback': 'yes',
  // vendors (CC9)
  'vendor-inventory': 'partial',
  'vendor-review': 'no',
  'dpa-signed': 'no',
  // availability (A1)
  'backups': 'yes',
  'backup-restore-test': 'no',
  'bcdr-plan': 'no',
  'capacity-monitoring': 'partial',
  // privacy (P)
  'data-inventory': 'partial',
  'privacy-notice': 'yes',
  'data-retention': 'partial',
  'data-subject-requests': 'yes',
  'data-classification': 'no',
};

// 5) Import engines (AFTER dotenv) and run.
const { runCodeAudit } = await import(`${SOC2}/code-audit.ts`);
const { runControlsAudit } = await import(`${SOC2}/controls-audit.ts`);

console.error('[run] code audit (Claude Sonnet holistic review) …');
const codeReport = await runCodeAudit(files);
console.error(`[run] code audit done — overall ${codeReport.scores.overall}/100, ${codeReport.findings.length} findings`);

console.error('[run] controls self-assessment …');
const controlsReport = await runControlsAudit(answers);
console.error(`[run] controls done — overall ${controlsReport.scores.overall}/100, ${controlsReport.findings.length} gaps`);

// 6) Live pentest — already run separately (98/100). Recorded as a known input.
const liveSummary = {
  mode: 'live',
  ranSeparately: true,
  overall: 98,
  note: 'Independent live pentest / external recon against korbee.app, scored 98/100. Run prior to this combined audit; not re-executed here.',
};

// 7) Combined readiness — blend the three lenses (documented weighting).
const WEIGHTS = { code: 0.35, controls: 0.40, live: 0.25 };
const combinedOverall = Math.round(
  codeReport.scores.overall * WEIGHTS.code +
  controlsReport.scores.overall * WEIGHTS.controls +
  liveSummary.overall * WEIGHTS.live,
);

const results = {
  meta: {
    target: 'korbee.app',
    repo: KORBEE,
    generatedFrom: 'grappes-app SOC 2 Lab engines',
    authorizedBy: 'Alexandru (owner)',
    disclaimer:
      'Readiness assessment only. NOT a SOC 2 audit or attestation; a SOC 2 report can only be issued by a licensed CPA firm.',
    weighting: WEIGHTS,
  },
  combinedOverall,
  modes: {
    code: codeReport,
    controls: controlsReport,
    mcp: {
      mode: 'mcp',
      skipped: true,
      reason:
        'No MCP / agent manifest present in the korbee repo (no mcp.json, .mcp.json, claude.json, .cursor/mcp.json, etc.). .claude/settings.local.json contains only Claude Code permissions, no mcpServers. Nothing to scan.',
      searched: MCP_CANDIDATES,
      found: mcpFound,
      settingsHasMcpServers: mcpSettingsHasServers,
      serversScanned: 0,
      toolsScanned: 0,
    },
    live: liveSummary,
  },
  codeAuditInput: {
    filesGathered: files.length,
    totalChars,
    filesScanned: codeReport.stats.filesScanned,
    linesScanned: codeReport.stats.linesScanned,
    fileList: files.map((f) => f.path),
    missing,
  },
  controlsAnswers: answers,
};

const outJson = join(homedir(), 'Desktop', 'korbee_full_soc2_results.json');
writeFileSync(outJson, JSON.stringify(results, null, 2), 'utf8');
console.error(`[out] wrote ${outJson} (${statSync(outJson).size} bytes)`);

// Compact console summary for the orchestrator.
console.log(JSON.stringify({
  combinedOverall,
  code: { overall: codeReport.scores.overall, scores: codeReport.scores, findings: codeReport.findings.length, summary: codeReport.summary },
  controls: { overall: controlsReport.scores.overall, scores: controlsReport.scores, coverage: controlsReport.coverage, gaps: controlsReport.findings.length, summary: controlsReport.summary },
  live: liveSummary,
  mcp: { skipped: true },
}, null, 2));
