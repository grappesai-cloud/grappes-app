/**
 * ─────────────────────────────────────────────────────────────────────────────
 *  Full SOC 2 readiness audit of korbee.app (the Orbit web app)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 *  Target repo : /Users/alexandrucojanu/Desktop/korbee   (korbee.app source)
 *  Scan engines: /Users/alexandrucojanu/grappes-app/src/lib/soc2/*
 *
 *  Pipeline:
 *    1. Load ANTHROPIC_API_KEY via dotenv BEFORE the engine modules are imported
 *       (the anthropic client is constructed at module-load time, so the key MUST
 *       be in process.env first — that is why every engine import below is a
 *       DYNAMIC import that runs strictly after loadEnv()).
 *    2. Gather key korbee source files (server, API routes, auth, config, DB).
 *    3. runCodeAudit()      — static pre-pass + Claude TSC review of the code.
 *    4. runControlsAudit()  — 38-question controls self-assessment, answered from
 *       observed evidence in the korbee codebase.
 *    5. runMcpStaticChecks()— only if an MCP config is found in the repo.
 *    6. Write results JSON + a readable Markdown report to ~/Desktop.
 *
 *  This is a READINESS assessment, never a SOC 2 attestation. The repo owner has
 *  authorized all scans.
 *
 *  Run:  cd /Users/alexandrucojanu/grappes-app && ./node_modules/.bin/tsx soc2-korbee-audit.ts
 */

// ── Static imports: node builtins + dotenv ONLY. None of these read the API key,
//    so loading them before dotenv runs is safe. The SOC 2 engines are imported
//    dynamically further down, AFTER the key is in process.env.
import { config as loadEnv } from "dotenv";
import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
} from "node:fs";
import { join, relative } from "node:path";
import { homedir } from "node:os";

// ── 1. Load the API key BEFORE any engine import ────────────────────────────
const ENV_CANDIDATES = [
  "/Users/alexandrucojanu/grappes-app/.env.local",
  "/Users/alexandrucojanu/grappes-app/.env",
];
const envPath = ENV_CANDIDATES.find(existsSync);
if (!envPath) {
  throw new Error(
    `No env file found. Looked for:\n  ${ENV_CANDIDATES.join("\n  ")}`,
  );
}
loadEnv({ path: envPath });
if (!process.env.ANTHROPIC_API_KEY) {
  throw new Error(`ANTHROPIC_API_KEY not present in ${envPath}`);
}
console.log(`✓ Loaded ANTHROPIC_API_KEY from ${envPath}`);

// ── 2. Now (and only now) pull in the SOC 2 engines ─────────────────────────
const SOC2_DIR = "/Users/alexandrucojanu/grappes-app/src/lib/soc2";
const { runCodeAudit } = await import(join(SOC2_DIR, "code-audit.ts"));
const { runControlsAudit, CONTROL_CATEGORIES } = await import(
  join(SOC2_DIR, "controls-audit.ts")
);

type CodeFile = { path: string; content: string };

// ── 2. Gather key korbee source files ───────────────────────────────────────
const KORBEE_ROOT = "/Users/alexandrucojanu/Desktop/korbee";

// Highest-signal files first — the engine truncates the corpus to ~120k chars,
// so ordering decides what Claude actually sees. Security-critical paths lead.
const PRIORITY_FILES = [
  // Request pipeline & security middleware
  "src/middleware.ts",
  "src/env.ts",
  // Auth
  "src/server/auth/index.ts",
  "src/server/auth/require.ts",
  "src/server/auth/sessions.ts",
  "src/lib/session.ts",
  "src/lib/auth-client.ts",
  // AuthZ / access control
  "src/server/authorize.ts",
  "src/lib/permissions.ts",
  "src/lib/module-gate.ts",
  // Platform safety
  "src/server/rate-limit.ts",
  "src/server/api-response.ts",
  "src/lib/logger.ts",
  "src/lib/fetch-with-timeout.ts",
  // Data layer
  "src/db/index.ts",
  "src/db/schema/auth.ts",
  "src/db/schema/two-factor.ts",
  "src/db/schema/audit.ts",
  "src/db/schema/audit-events.ts",
  "src/db/schema/share_tokens.ts",
  "src/db/schema/ratelimits.ts",
  // Money / webhooks (signature verification, IDOR surface)
  "src/pages/api/stripe/webhook.ts",
  "src/pages/api/stripe/checkout.ts",
  "src/pages/api/stripe/portal.ts",
  "src/server/stripe/service.ts",
  // Privacy / DSAR surface
  "src/pages/api/account/delete.ts",
  "src/pages/api/account/export.ts",
  "src/pages/api/account/sessions.ts",
  "src/server/account/service.ts",
  // Admin & audit
  "src/pages/api/admin/users/[id].ts",
  "src/server/admin/service.ts",
  "src/server/audit/service.ts",
  "src/server/audit/user.ts",
  // Token-protected public surfaces (authz-by-token)
  "src/pages/api/calendar/feed/[token].ts",
  "src/pages/api/calendar/token.ts",
  "src/pages/api/projects/[id]/share.ts",
  "src/pages/api/inbound/booking.ts",
  // Object-level authz surfaces
  "src/pages/api/projects/[id].ts",
  "src/pages/api/contacts/[id].ts",
  "src/pages/api/invoices/[id].ts",
  "src/pages/api/chat/[channelId]/messages.ts",
  "src/pages/api/transactions/import.ts",
  "src/pages/api/contracts/upload.ts",
  // AI endpoints (prompt-injection / data-flow surface)
  "src/server/ai/contract-review.ts",
  "src/server/ai/receipt.ts",
  "src/pages/api/ai/finance-query.ts",
  // Email / cron
  "src/server/email/index.ts",
  "src/pages/api/cron/cleanup.ts",
  "src/pages/api/health.ts",
  "src/pages/api/search.ts",
  // Config
  "astro.config.mjs",
  "vercel.json",
  "drizzle.config.ts",
  "tsconfig.json",
];

const TEXT_EXT = new Set([".ts", ".tsx", ".astro", ".mjs", ".js", ".json"]);

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".git" || name === "dist") continue;
    const full = join(dir, name);
    let s;
    try {
      s = statSync(full);
    } catch {
      continue;
    }
    if (s.isDirectory()) walk(full, out);
    else if (TEXT_EXT.has(name.slice(name.lastIndexOf("."))) && s.size < 60_000)
      out.push(full);
  }
  return out;
}

function gatherFiles(): CodeFile[] {
  const seen = new Set<string>();
  const files: CodeFile[] = [];

  const add = (abs: string) => {
    const rel = relative(KORBEE_ROOT, abs);
    if (seen.has(rel)) return;
    if (!existsSync(abs)) return;
    let content: string;
    try {
      content = readFileSync(abs, "utf8");
    } catch {
      return;
    }
    seen.add(rel);
    files.push({ path: rel, content });
  };

  // 1) curated priority list (in order)
  for (const rel of PRIORITY_FILES) add(join(KORBEE_ROOT, rel));

  // 2) sweep the rest of the server / api / db / security-lib surface so the
  //    static scanner also sees secret/injection patterns we did not hand-pick
  const sweepDirs = [
    "src/server",
    "src/pages/api",
    "src/db",
    "src/lib",
  ];
  for (const d of sweepDirs)
    for (const abs of walk(join(KORBEE_ROOT, d))) add(abs);

  return files;
}

// ── 3. Answer the 38-control catalog from observed korbee evidence ──────────
// Each answer is grounded in concrete evidence read out of the korbee codebase.
// yes = control observed in place · partial = present but not enforced/documented
// no = no evidence the control exists · (no 'na' — every control applies to a
// SaaS handling user PII + payments).
type Answer = "yes" | "partial" | "no" | "na";
const ANSWERS: Record<string, { answer: Answer; rationale: string }> = {
  // ── Governance & control environment (CC1) ──
  "security-policy": { answer: "no", rationale:
    "docs/ contains ARCHITECTURE, DEPLOYMENT, EMAIL, OAUTH, CHANGELOG — no written, dated, leadership-approved information security policy." },
  "security-owner": { answer: "partial", rationale:
    "A privileged admin role exists in code (role:'admin' gates in middleware/authorize/audit), so an owner exists implicitly, but there is no documented named security accountability (CISO/security lead)." },
  "org-chart-roles": { answer: "partial", rationale:
    "Roles are defined technically (admin/user, team roles, project member roles in permissions.ts / authorize.ts) but there is no org chart or responsibility matrix document." },
  "background-checks": { answer: "no", rationale:
    "No evidence of personnel screening / confidentiality agreements (early-stage; no HR artifacts in repo)." },
  "security-training": { answer: "no", rationale:
    "No evidence of recurring security awareness training." },

  // ── Risk assessment (CC3) ──
  "risk-assessment": { answer: "no", rationale: "No documented annual risk assessment found." },
  "risk-register": { answer: "no", rationale: "No risk register with owners/remediation status found." },
  "fraud-risk": { answer: "no", rationale: "No documented fraud / insider-threat risk consideration." },

  // ── Logical access control (CC6) ──
  "mfa-enforced": { answer: "partial", rationale:
    "TOTP 2FA is implemented (better-auth twoFactor plugin, two-factor schema, TwoFactorPanel, skipVerificationOnEnable:false) and breached-password blocking via haveIBeenPwned, but 2FA is opt-in per user — NOT enforced on admin/all accounts." },
  "access-provisioning": { answer: "partial", rationale:
    "An invite system grants scoped access with roles (api/invites, api/team/invites, invites schema), but there is no documented formal request/approval workflow for production/system access." },
  "access-reviews": { answer: "no", rationale:
    "No evidence of periodic (quarterly) access reviews of who can reach production/key systems." },
  "offboarding": { answer: "no", rationale:
    "End-user account deletion exists (api/account/delete.ts) and sessions can be revoked, but there is no documented 24-hour staff/contractor access-revocation process." },
  "least-privilege": { answer: "yes", rationale:
    "Strong RBAC: authorize.ts enforces object-level access (project ownership/membership, self, channel), middleware module-gate blocks off-limits modules per profileType/teamRole/role, each user has their own account (no shared admin login)." },
  "encryption-rest": { answer: "yes", rationale:
    "Data lives in Neon Postgres (encrypted at rest by default) and Vercel Blob (encrypted at rest); no self-managed unencrypted stores observed." },
  "encryption-transit": { answer: "yes", rationale:
    "TLS everywhere: HSTS header set for https, secure cookies on https (useSecureCookies), Neon accessed over HTTPS (@neondatabase/serverless neon-http), strict CSP/connect-src to https origins only." },
  "key-management": { answer: "partial", rationale:
    "No secrets in code; .env / .env*.local and secrets/ + *.p8 are gitignored; secrets are injected via Vercel/host env. But this is host env-var storage, not a dedicated managed vault with documented rotation." },

  // ── Monitoring & incident response (CC7) ──
  "logging": { answer: "yes", rationale:
    "Structured JSON logger (lib/logger.ts) plus a persisted admin audit trail (adminActions table via server/audit/service.ts) recording actor, email, action, target, IP and metadata; Vercel platform logs centralize stdout/stderr." },
  "monitoring-alerts": { answer: "yes", rationale:
    "Sentry is wired in (@sentry/astro, SENTRY_DSN) for error capture/alerting; Vercel Analytics + Speed Insights provide additional signal." },
  "vuln-management": { answer: "no", rationale:
    "No Dependabot/renovate config, no .github at all, no documented patch/scan SLA. (Password-breach checking via haveIBeenPwned is app-level, not dependency scanning.)" },
  "incident-plan": { answer: "no", rationale: "No written incident response plan with roles/steps found." },
  "incident-drill": { answer: "no", rationale: "No evidence of an incident tabletop/drill in the last year." },
  "pentest": { answer: "no", rationale:
    "No evidence of an independent annual penetration test. (Code shows security awareness — e.g. GHSA-mr6q-rp88-fx84 mitigation in middleware — but that is not a pentest.)" },

  // ── Change management (CC8) ──
  "code-review": { answer: "no", rationale:
    "No CODEOWNERS / PR templates / .github and no observable enforced peer-review process (single-maintainer git history)." },
  "branch-protection": { answer: "no", rationale:
    "No .github and no evidence of protected main branch / required checks." },
  "ci-tests": { answer: "partial", rationale:
    "Automated tests exist (vitest config + 5 test files: api-response, module-gate, permissions, profile-slugify, session) but there is no CI pipeline (.github/workflows absent) gating deploys, so tests are not enforced before production." },
  "separate-environments": { answer: "yes", rationale:
    "Vercel production + preview deployments and Neon prod + preview branches keep dev/preview/prod separated (docs/ARCHITECTURE.md, docs/DEPLOYMENT.md)." },
  "rollback": { answer: "yes", rationale:
    "Documented rollback path: `vercel rollback <deployment-id>` via dashboard/CLI (docs/DEPLOYMENT.md)." },

  // ── Vendor & third-party risk (CC9) ──
  "vendor-inventory": { answer: "partial", rationale:
    "Subprocessors are identifiable from config/env (Neon, Vercel, Stripe, Resend, Sentry, Anthropic, Vercel Blob) but there is no maintained subprocessor inventory document." },
  "vendor-review": { answer: "no", rationale:
    "No evidence of reviewing vendors' security posture / SOC 2 reports before or during use." },
  "dpa-signed": { answer: "no", rationale:
    "No evidence of signed DPAs / contractual security & privacy terms with subprocessors." },

  // ── Availability (A1) ──
  "backups": { answer: "yes", rationale:
    "Database is Neon Postgres (managed automated backups + point-in-time recovery, stored separately from compute)." },
  "backup-restore-test": { answer: "no", rationale:
    "No evidence a restore-from-backup has been tested in the last year." },
  "bcdr-plan": { answer: "no", rationale:
    "No business continuity / disaster recovery plan with RTO/RPO targets found." },
  "capacity-monitoring": { answer: "partial", rationale:
    "Vercel Analytics + Speed Insights + Sentry give uptime/performance/error signal and there is a /api/health endpoint, but there is no formal SLA/capacity tracking." },

  // ── Privacy & data handling (P / C) ──
  "data-inventory": { answer: "partial", rationale:
    "The Drizzle schema enumerates exactly what personal data is collected and where it lives (profiles, contacts, transactions, chat, etc.), but there is no formal data map / inventory document tying fields to purpose." },
  "privacy-notice": { answer: "yes", rationale:
    "A public privacy notice and terms are served (src/pages/privacy.astro, src/pages/terms.astro) and are whitelisted as public routes in middleware." },
  "data-retention": { answer: "partial", rationale:
    "A daily cleanup cron exists (vercel.json -> /api/cron/cleanup) enforcing some retention (e.g. rate-limit rows), but there is no documented, comprehensive data retention & deletion policy across all data classes." },
  "data-subject-requests": { answer: "yes", rationale:
    "Users can both export their data (api/account/export.ts) and delete their account/data (api/account/delete.ts), and manage/revoke active sessions (api/account/sessions) — covering DSAR access + erasure." },
  "data-classification": { answer: "no", rationale:
    "No formal data-classification scheme with per-class handling rules found." },
};

// ── helper: build the readable Markdown report ──────────────────────────────
const BAR = (n: number) => {
  const filled = Math.round((n / 100) * 20);
  return "█".repeat(filled) + "░".repeat(20 - filled);
};
const sevEmoji: Record<string, string> = {
  critical: "🔴", high: "🟠", medium: "🟡", low: "🔵", info: "⚪",
};

function buildMarkdown(o: any): string {
  const d = new Date().toISOString().slice(0, 10);
  const code = o.code;
  const controls = o.controls;
  const L: string[] = [];

  L.push(`# SOC 2 Readiness Audit — korbee.app`);
  L.push("");
  L.push(`**Target:** \`${KORBEE_ROOT}\` (Orbit web app)  `);
  L.push(`**Date:** ${d}  `);
  L.push(`**Engines:** code-audit · controls-audit${o.mcp.ran ? " · mcp-static-checks" : ""}  `);
  L.push(`**Authorization:** Repo owner authorized all scans.`);
  L.push("");
  L.push(`> ⚠️ ${code.disclaimer}`);
  L.push("");
  L.push("---");
  L.push("");

  // Executive scorecard (average of the two engines' overall scores)
  const combinedOverall = Math.round((code.scores.overall + controls.scores.overall) / 2);
  L.push(`## Executive summary`);
  L.push("");
  L.push(`**Combined readiness: ${combinedOverall}/100**`);
  L.push("");
  L.push(`| Engine | Overall | Sec | Avail | Conf | Integ | Priv |`);
  L.push(`|---|---|---|---|---|---|---|`);
  const row = (name: string, s: any) =>
    `| ${name} | **${s.overall}** | ${s.security} | ${s.availability} | ${s.confidentiality} | ${s.integrity} | ${s.privacy} |`;
  L.push(row("Code audit", code.scores));
  L.push(row("Controls self-assessment", controls.scores));
  L.push("");
  L.push(`**Code audit:** ${code.summary}`);
  L.push("");
  L.push(`**Controls:** ${controls.summary}`);
  L.push("");
  L.push("---");
  L.push("");

  // ── Code audit ──
  L.push(`## 1. Code audit (static pre-pass + Claude TSC review)`);
  L.push("");
  L.push(`Scanned **${code.stats.filesScanned} files / ${code.stats.linesScanned} lines**.`);
  L.push("");
  for (const [k, label] of [
    ["security", "Security"], ["availability", "Availability"],
    ["confidentiality", "Confidentiality"], ["integrity", "Processing Integrity"],
    ["privacy", "Privacy"],
  ] as const) {
    L.push(`- ${label.padEnd(20)} \`${BAR((code.scores as any)[k])}\` ${(code.scores as any)[k]}/100`);
  }
  L.push("");
  L.push(`### Findings (${code.findings.length})`);
  L.push("");
  const sevOrder = ["critical", "high", "medium", "low", "info"];
  const sorted = [...code.findings].sort(
    (a: any, b: any) => sevOrder.indexOf(a.severity) - sevOrder.indexOf(b.severity),
  );
  for (const f of sorted) {
    L.push(`#### ${sevEmoji[f.severity] ?? ""} [${String(f.severity).toUpperCase()}] ${f.title}`);
    L.push(`- **Criterion:** ${f.criterion}${f.evidence ? ` · **Evidence:** \`${f.evidence}\`` : ""}`);
    if (f.frameworks?.soc2?.length) L.push(`- **SOC 2:** ${f.frameworks.soc2.join(", ")}`);
    L.push(`- **Issue:** ${f.detail}`);
    if (f.fix) L.push(`- **Fix:** ${f.fix}`);
    L.push("");
  }
  if (code.roadmap.length) {
    L.push(`### Code remediation roadmap`);
    L.push("");
    L.push(`| # | Item | Criterion | Effort |`);
    L.push(`|---|---|---|---|`);
    for (const r of code.roadmap)
      L.push(`| ${r.priority} | ${r.title} — ${r.detail} | ${r.criterion} | ${r.effort} |`);
    L.push("");
  }
  L.push("---");
  L.push("");

  // ── Controls ──
  L.push(`## 2. Controls self-assessment (38 controls)`);
  L.push("");
  L.push(`Answered from observed evidence in the korbee codebase. ${controls.disclaimer}`);
  L.push("");
  const cov = controls.coverage;
  L.push(`**Coverage:** ${cov.inPlace} in place · ${cov.partial} partial · ${cov.gaps} gaps · ${cov.skipped} n/a — of ${cov.total} applicable controls.`);
  L.push("");
  L.push(`| Category | In place / total |`);
  L.push(`|---|---|`);
  for (const c of cov.byCategory) L.push(`| ${c.label} | ${c.inPlace}/${c.total} |`);
  L.push("");
  for (const [k, label] of [
    ["security", "Security"], ["availability", "Availability"],
    ["confidentiality", "Confidentiality"], ["integrity", "Processing Integrity"],
    ["privacy", "Privacy"],
  ] as const) {
    L.push(`- ${label.padEnd(20)} \`${BAR((controls.scores as any)[k])}\` ${(controls.scores as any)[k]}/100`);
  }
  L.push("");

  // Per-control answer log, grouped by category
  L.push(`### Answer log (with evidence)`);
  L.push("");
  const mark: Record<Answer, string> = { yes: "✅ yes", partial: "🟡 partial", no: "❌ no", na: "➖ n/a" };
  for (const cat of CONTROL_CATEGORIES) {
    L.push(`#### ${cat.label} — ${cat.blurb}`);
    L.push("");
    L.push(`| Control | Ref | Answer | Evidence / rationale |`);
    L.push(`|---|---|---|---|`);
    for (const ctl of cat.controls) {
      const a = ANSWERS[ctl.id];
      const ans = a ? a.answer : "na";
      const why = a ? a.rationale.replace(/\|/g, "\\|") : "(unanswered)";
      L.push(`| ${ctl.question.replace(/\|/g, "\\|")} | ${ctl.ref} | ${mark[ans]} | ${why} |`);
    }
    L.push("");
  }

  if (controls.roadmap.length) {
    L.push(`### Controls remediation roadmap (top ${controls.roadmap.length})`);
    L.push("");
    L.push(`| # | Item | Criterion | Effort |`);
    L.push(`|---|---|---|---|`);
    for (const r of controls.roadmap)
      L.push(`| ${r.priority} | ${r.title} | ${r.criterion} | ${r.effort} |`);
    L.push("");
  }
  L.push("---");
  L.push("");

  // ── MCP ──
  L.push(`## 3. MCP / agent-layer scan`);
  L.push("");
  if (o.mcp.ran) {
    L.push(`Scanned ${o.mcp.result.serversScanned} server(s) / ${o.mcp.result.toolsScanned} tool(s); ${o.mcp.result.findings.length} finding(s).`);
    for (const f of o.mcp.result.findings)
      L.push(`- ${sevEmoji[f.severity] ?? ""} [${f.severity}] ${f.title} — ${f.detail}`);
  } else {
    L.push(`Skipped — ${o.mcp.reason}`);
  }
  L.push("");
  L.push("---");
  L.push("");
  L.push(`## How to read this`);
  L.push("");
  L.push(`The **code audit** sees what the source proves. The **controls self-assessment** covers the ~70% of SOC 2 that lives in process and paperwork, which code cannot show. korbee scores well on engineered controls (encryption in transit/at rest, RBAC/least-privilege, 2FA support, security headers, audit logging, env separation, DSAR export+delete) and has the gaps typical of an early-stage product: no written policies, risk register, incident-response plan, vendor reviews/DPAs, CI gating, or independent pentest. Closing the documentation-and-process gaps is the path to an auditable SOC 2 Type I/II.`);
  L.push("");
  return L.join("\n");
}

// ── 4. Run everything ───────────────────────────────────────────────────────
(async () => {
  const startedAt = new Date().toISOString();

  // Gather corpus
  const files = gatherFiles();
  const totalChars = files.reduce((n, f) => n + f.content.length, 0);
  console.log(`✓ Gathered ${files.length} korbee files (${totalChars.toLocaleString()} chars)`);

  // Code audit
  console.log("→ Running code audit (static + Claude review)…");
  const code = await runCodeAudit(files);
  console.log(`  code overall: ${code.scores.overall}/100, ${code.findings.length} findings`);

  // Controls audit
  console.log("→ Running controls self-assessment…");
  const answers = Object.fromEntries(
    Object.entries(ANSWERS).map(([id, v]) => [id, v.answer]),
  );
  const controls = await runControlsAudit(answers);
  console.log(`  controls overall: ${controls.scores.overall}/100, ${controls.coverage.inPlace}/${controls.coverage.total} in place`);

  // MCP — only if korbee actually ships an MCP config
  console.log("→ Checking for MCP configs in korbee…");
  let mcp: any = { ran: false, reason: "No MCP server configs (.mcp.json / mcpServers / tools manifest) found in the korbee repo." };
  const MCP_CANDIDATES = [
    ".mcp.json", "mcp.json", ".vscode/mcp.json", ".cursor/mcp.json",
    "claude_desktop_config.json", ".claude/mcp.json",
  ].map((p) => join(KORBEE_ROOT, p));
  const mcpFile = MCP_CANDIDATES.find(existsSync);
  if (mcpFile) {
    try {
      const manifest = JSON.parse(readFileSync(mcpFile, "utf8"));
      const { runMcpStaticChecks } = await import(join(SOC2_DIR, "mcp-checks.ts"));
      const result = runMcpStaticChecks(manifest);
      mcp = { ran: true, source: relative(KORBEE_ROOT, mcpFile), result };
      console.log(`  MCP scan: ${result.findings.length} findings from ${mcpFile}`);
    } catch (err: any) {
      mcp = { ran: false, reason: `Found ${mcpFile} but failed to scan: ${err?.message ?? err}` };
    }
  } else {
    console.log("  none found — skipping MCP checks");
  }

  // Assemble + persist
  const out = {
    meta: {
      target: "korbee.app",
      repo: KORBEE_ROOT,
      engines: `${SOC2_DIR}`,
      envFile: envPath,
      startedAt,
      finishedAt: new Date().toISOString(),
      filesScanned: files.length,
      corpusChars: totalChars,
      note: "Readiness assessment only — not a SOC 2 audit or attestation.",
    },
    code,
    controls: { ...controls, answers: ANSWERS },
    mcp,
  };

  const desktop = join(homedir(), "Desktop");
  const jsonPath = join(desktop, "korbee_full_soc2_results.json");
  const mdPath = join(desktop, "korbee_full_soc2_audit.md");
  writeFileSync(jsonPath, JSON.stringify(out, null, 2));
  writeFileSync(mdPath, buildMarkdown(out));

  console.log("");
  console.log(`✓ Results: ${jsonPath}`);
  console.log(`✓ Report:  ${mdPath}`);
  console.log("");
  const combined = Math.round((code.scores.overall + controls.scores.overall) / 2);
  console.log(`Combined readiness: ${combined}/100  (code ${code.scores.overall} · controls ${controls.scores.overall})`);
})().catch((err) => {
  console.error("AUDIT FAILED:", err);
  process.exit(1);
});
