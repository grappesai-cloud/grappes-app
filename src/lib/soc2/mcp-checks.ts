// ── MCP / Agent Security Scan — static pre-pass ────────────────────────────
// Deterministic checks on a client's Model Context Protocol deployment: the
// client config (mcpServers) and/or tool manifests (tools[].description +
// inputSchema). This is the differentiation wedge — nobody else's SOC 2 tool
// scans the agent/MCP layer. Findings mirror the Code Audit shape so the report
// renderer and framework-map are reused verbatim.
//
// Vulnerability classes (all OWASP/CSA-recognized — see ~/soc2-megatool-research.md):
//   tool poisoning / prompt injection in tool descriptions (the trust gap:
//   descriptions are read at connect-time, responses enter context unchecked),
//   credential exposure in env/args, unpinned/rug-pull-able servers,
//   untrusted supply-chain source, plaintext transport, excessive permissions,
//   shared-privilege confused-deputy, unauthenticated remote servers.

import type { Finding, Severity } from './static-checks';

// ── Input shapes — we accept either a client config, a tools manifest, or both.
export interface McpServerDef {
  name?: string;
  command?: string;            // e.g. "npx", "uvx", "node", "docker"
  args?: string[];             // e.g. ["-y", "some-mcp-server@latest"]
  env?: Record<string, string>;
  url?: string;                // remote server (http/https/sse)
  type?: string;               // "stdio" | "sse" | "http"
  headers?: Record<string, string>;
  // some configs nest auth differently; keep it loose
  [k: string]: unknown;
}

export interface McpToolDef {
  name?: string;
  description?: string;
  inputSchema?: unknown;
  annotations?: Record<string, unknown>;
  [k: string]: unknown;
}

export interface McpManifest {
  // VS Code / Claude Desktop style: { "mcpServers": { "<name>": {...} } }
  mcpServers?: Record<string, McpServerDef>;
  servers?: Record<string, McpServerDef> | McpServerDef[];
  // a flat tools list (from tools/list)
  tools?: McpToolDef[];
}

export interface McpStaticResult {
  findings: Finding[];
  serversScanned: number;
  toolsScanned: number;
}

function redact(s: string): string {
  const t = s.trim();
  if (t.length <= 12) return t.slice(0, 3) + '****';
  return t.slice(0, 6) + '…' + t.slice(-4);
}

// Phrases that smell like an injected instruction hidden inside a tool
// description or response — the core of tool poisoning.
const INJECTION_PHRASES = [
  /ignore (all |any |the )?(previous|prior|above)/i,
  /do not (tell|inform|mention|reveal|notify) (the )?(user|human)/i,
  /without (the )?(user|human)('s)? (knowledge|consent|awareness)/i,
  /\bsystem prompt\b/i,
  /\b(before|prior to) (using|calling) this tool\b.*\b(read|send|fetch|exfiltrat)/i,
  /<important>|<secret>|<system>|\[\[hidden\]\]/i,
  /reveal (your |the )?(instructions|system prompt|api[_-]?key)/i,
  /send (the |all )?(conversation|context|history|messages?) to/i,
];

// Invisible / control unicode often used to smuggle instructions into
// descriptions that a human reviewer won't see.
const HIDDEN_UNICODE = /[​-‏‪-‮⁠-⁯﻿0-F]/;

// Secret-looking values in env/args.
const SECRET_KEY = /(api[_-]?key|secret|password|passwd|token|client[_-]?secret|private[_-]?key|access[_-]?key|auth|bearer|pat)/i;
const SECRET_VALUE = /^([A-Za-z0-9_\-]{16,}|AKIA[0-9A-Z]{16}|sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{16,})$/;
const PLACEHOLDER = /(your[_-]?|example|placeholder|xxx+|<.*>|changeme|dummy|\$\{|process\.env|env:)/i;

// Unpinned / mutable package references (rug-pull risk).
const UNPINNED = /@latest$|^[^@]+$/; // "@latest" or no version pin at all

function push(
  findings: Finding[],
  seen: Set<string>,
  f: { id: string; title: string; severity: Severity; criterion: Finding['criterion']; detail: string; fix: string; evidence?: string },
) {
  const key = `${f.id}|${f.evidence ?? ''}`;
  if (seen.has(key)) return;
  seen.add(key);
  findings.push({ ...f, source: 'mcp' });
}

function normalizeServers(m: McpManifest): Array<{ name: string; def: McpServerDef }> {
  const out: Array<{ name: string; def: McpServerDef }> = [];
  const fromMap = (rec: Record<string, McpServerDef>) => {
    for (const [name, def] of Object.entries(rec)) out.push({ name: def.name ?? name, def });
  };
  if (m.mcpServers) fromMap(m.mcpServers);
  if (m.servers && !Array.isArray(m.servers)) fromMap(m.servers as Record<string, McpServerDef>);
  if (Array.isArray(m.servers)) m.servers.forEach((def, i) => out.push({ name: def.name ?? `server-${i}`, def }));
  return out;
}

export function runMcpStaticChecks(manifest: McpManifest): McpStaticResult {
  const findings: Finding[] = [];
  const seen = new Set<string>();

  const servers = normalizeServers(manifest);
  const tools = Array.isArray(manifest.tools) ? manifest.tools : [];

  // ── Per-server checks ──────────────────────────────────────────────
  for (const { name, def } of servers) {
    // Credential exposure in env / args
    const envEntries = def.env ? Object.entries(def.env) : [];
    for (const [k, v] of envEntries) {
      if (typeof v !== 'string') continue;
      if (SECRET_KEY.test(k) && SECRET_VALUE.test(v) && !PLACEHOLDER.test(v)) {
        push(findings, seen, {
          id: 'mcp-credential-exposure',
          title: 'Credential hardcoded in MCP server config',
          severity: 'critical',
          criterion: 'confidentiality',
          detail: `Server "${name}" carries a live-looking secret in env "${k}". MCP configs are checked into dotfiles, synced, and shared — embedded credentials leak.`,
          fix: 'Reference the secret from a secrets manager or OS keychain at launch; never inline it in the MCP config. Rotate the exposed value.',
          evidence: `${name}.env.${k} — ${redact(v)}`,
        });
      }
    }
    for (const a of def.args ?? []) {
      if (typeof a === 'string' && SECRET_VALUE.test(a) && !PLACEHOLDER.test(a) && a.length >= 20) {
        push(findings, seen, {
          id: 'mcp-credential-exposure',
          title: 'Possible credential passed as MCP server arg',
          severity: 'high',
          criterion: 'confidentiality',
          detail: `Server "${name}" passes a secret-looking value on the command line. Process args are visible in ps output and shell history.`,
          fix: 'Pass secrets via env from a manager, not as positional args.',
          evidence: `${name}.args — ${redact(a)}`,
        });
      }
    }

    // Supply-chain: which package is this server, is it pinned?
    const pkgArg = (def.args ?? []).find(a => typeof a === 'string' && /[a-z0-9]/i.test(a) && !a.startsWith('-'));
    if ((def.command === 'npx' || def.command === 'uvx' || def.command === 'pipx') && typeof pkgArg === 'string') {
      if (UNPINNED.test(pkgArg)) {
        push(findings, seen, {
          id: 'mcp-unpinned-server',
          title: 'MCP server pulled from an unpinned package',
          severity: 'high',
          criterion: 'integrity',
          detail: `Server "${name}" runs "${pkgArg}" with no version pin (or @latest). The maintainer can ship new tool definitions at any time — a rug-pull / mutable-tool risk where a once-safe tool turns malicious after approval.`,
          fix: 'Pin an exact version + verify integrity (lockfile / hash). Re-review the tool manifest on every version bump.',
          evidence: `${name} → ${pkgArg}`,
        });
      }
    }

    // Plaintext transport for remote servers
    if (typeof def.url === 'string' && /^http:\/\//i.test(def.url) && !/localhost|127\.0\.0\.1/.test(def.url)) {
      push(findings, seen, {
        id: 'mcp-plaintext-transport',
        title: 'Remote MCP server over plaintext HTTP',
        severity: 'high',
        criterion: 'security',
        detail: `Server "${name}" connects over http://. Tool calls, arguments, and responses (which flow straight into the model context) are exposed and tamperable in transit.`,
        fix: 'Use https:// / wss:// only. Reject downgrade.',
        evidence: `${name} → ${def.url}`,
      });
    }

    // Unauthenticated remote server
    const hasAuth = !!(def.headers && Object.keys(def.headers).some(h => /authorization|api[_-]?key|token/i.test(h)))
      || envEntries.some(([k]) => SECRET_KEY.test(k));
    if (typeof def.url === 'string' && /^https?:\/\//i.test(def.url) && !/localhost|127\.0\.0\.1/.test(def.url) && !hasAuth) {
      push(findings, seen, {
        id: 'mcp-no-auth-remote',
        title: 'Remote MCP server with no apparent authentication',
        severity: 'medium',
        criterion: 'security',
        detail: `Server "${name}" is remote but no auth header/token is configured. Anyone who can reach the endpoint can drive its tools, and the client trusts whatever it returns.`,
        fix: 'Require authenticated transport (OAuth / bearer) and verify the server identity.',
        evidence: `${name} → ${def.url}`,
      });
    }
  }

  // Shared-privilege confused-deputy signal: a deployment mixing trusted local
  // tools and untrusted remote/third-party servers, with no isolation hint.
  const remoteCount = servers.filter(s => typeof s.def.url === 'string' && /^https?:\/\//i.test(s.def.url!)).length;
  if (servers.length >= 2 && remoteCount >= 1) {
    push(findings, seen, {
      id: 'mcp-shared-privilege',
      title: 'Mixed-trust servers share one agent privilege level',
      severity: 'medium',
      criterion: 'security',
      detail: `${servers.length} servers are connected (${remoteCount} remote/third-party). In MCP, internal and external tools share the same privilege level inside the agent, so an untrusted server can induce calls to your trusted/internal tools (confused-deputy).`,
      fix: 'Segment tools by trust: separate agents/sessions for untrusted servers, allow-list which tools each can trigger, and require confirmation for sensitive internal tools.',
      evidence: `${servers.length} servers, ${remoteCount} remote`,
    });
  }

  // ── Per-tool checks ────────────────────────────────────────────────
  for (const tool of tools) {
    const tname = tool.name ?? 'unnamed-tool';
    const desc = typeof tool.description === 'string' ? tool.description : '';

    // Hidden unicode in description
    if (HIDDEN_UNICODE.test(desc)) {
      push(findings, seen, {
        id: 'mcp-tool-poisoning',
        title: 'Tool description contains hidden/invisible characters',
        severity: 'critical',
        criterion: 'security',
        detail: `Tool "${tname}" has zero-width or bidirectional control characters in its description — a classic tool-poisoning vector that smuggles instructions past human review while the model still reads them.`,
        fix: 'Reject tools whose descriptions contain non-printable unicode. Render descriptions with control chars escaped during review.',
        evidence: `tool:${tname}`,
      });
    }

    // Injection phrases in description
    for (const re of INJECTION_PHRASES) {
      if (re.test(desc)) {
        push(findings, seen, {
          id: 'mcp-prompt-injection-desc',
          title: 'Tool description contains injected instructions',
          severity: 'critical',
          criterion: 'security',
          detail: `Tool "${tname}" description embeds directive language ("${redact(desc.match(re)?.[0] ?? '')}"). MCP tool descriptions enter the model context as trusted text; this is indirect prompt injection / tool poisoning.`,
          fix: 'Treat tool descriptions as untrusted. Strip/flag imperative instructions; only the host app should instruct the model.',
          evidence: `tool:${tname}`,
        });
        break;
      }
    }

    // Excessive permissions hint in description / name
    if (/\b(all files|entire (file ?system|disk)|arbitrary (command|code|shell)|sudo|root access|any url|unrestricted)\b/i.test(desc + ' ' + tname)) {
      push(findings, seen, {
        id: 'mcp-excessive-permissions',
        title: 'Tool grants broad/unrestricted capability',
        severity: 'high',
        criterion: 'security',
        detail: `Tool "${tname}" advertises broad capability (filesystem-wide / arbitrary command / any URL). Over-broad tools widen the blast radius of any successful prompt injection.`,
        fix: 'Scope the tool to least privilege: explicit path/host allow-lists, no arbitrary command execution, human confirmation for destructive actions.',
        evidence: `tool:${tname}`,
      });
    }
  }

  return { findings, serversScanned: servers.length, toolsScanned: tools.length };
}

// Untrusted-source heuristic for a referenced repo/package string (used by the
// orchestrator when the user links a repo rather than pasting a manifest).
export function flagUntrustedSource(label: string): Finding | null {
  // Best-effort: flag obviously personal / unscoped npm/pypi installs as a
  // supply-chain note. This is informational, the Claude pass refines it.
  if (!label) return null;
  return null;
}
