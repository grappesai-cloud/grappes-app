// ── SOC 2 Code Audit — static pre-pass ─────────────────────────────────────
// Cheap, deterministic regex checks that seed concrete findings before the
// Claude review. These catch the high-signal, low-ambiguity issues (hardcoded
// secrets, plaintext transport, dangerous sinks) so Claude can focus on the
// holistic Trust Service Criteria reasoning instead of re-deriving them.

export type TSC =
  | 'security'
  | 'availability'
  | 'confidentiality'
  | 'integrity'   // Processing Integrity
  | 'privacy';

export type Severity = 'critical' | 'high' | 'medium' | 'low' | 'info';

export interface Finding {
  id: string;            // stable slug, e.g. "hardcoded-secret"
  title: string;
  severity: Severity;
  criterion: TSC;
  detail: string;        // what's wrong
  fix: string;           // how to fix it
  evidence?: string;     // a redacted snippet / file:line / control ref
  source: 'static' | 'ai' | 'questionnaire' | 'mcp' | 'sca' | 'evidence' | 'authz' | 'sast';
  // Set by the adversarial verification pass (verify-findings.ts).
  confidence?: number;   // 0..1 — how sure we are this is real (post-verification)
  cvss?: number;         // 0..10 — CVSS-style base score for vuln-type findings
  verified?: boolean;    // true once the verification pass has reviewed it
  control?: string;      // specific SOC 2 control ref, e.g. "CC6.1"
}

// A single file submitted for review
export interface CodeFile {
  path: string;
  content: string;
}

// Redact the middle of a matched secret so we never echo it back in full
function redact(s: string): string {
  const t = s.trim();
  if (t.length <= 12) return t.slice(0, 3) + '****';
  return t.slice(0, 6) + '…' + t.slice(-4);
}

interface Rule {
  id: string;
  title: string;
  severity: Severity;
  criterion: TSC;
  detail: string;
  fix: string;
  // The regex. By default it is run per-line. With `scope: 'file'` it runs
  // against the whole file content (so it can span multiple lines) — give such
  // patterns the `m`/`s` flags as needed; line numbers are derived from the
  // match offset.
  pattern: RegExp;
  scope?: 'line' | 'file';
  // Evidence is capture group `evidenceGroup` if set, else group 1, else the
  // whole match. (Some rules want a later group as the redacted snippet.)
  evidenceGroup?: number;
  // optional guard to drop false positives (e.g. obvious placeholders). Receives
  // the matched text (line, or the whole match for file-scope rules).
  ignoreIf?: (text: string, match: RegExpMatchArray) => boolean;
}

const PLACEHOLDER = /(your[_-]?|example|placeholder|xxx+|<.*>|changeme|dummy|test[_-]?key|sk_test_|pk_test_|process\.env|import\.meta\.env|getenv|os\.environ|REDACTED|FAKE|sample|foobar|deadbeef)/i;

// URLs that are namespaces / schema identifiers, not network calls — http:// here
// is correct and must not be flagged as plaintext transport.
const SCHEMA_URL = /w3\.org|xmlns|schemas?\.|\.dtd|\.xsd|purl\.org|tempuri\.org|example\.(com|org|net)/i;

const RULES: Rule[] = [
  {
    id: 'hardcoded-secret-assignment',
    title: 'Hardcoded secret in source',
    severity: 'critical',
    criterion: 'confidentiality',
    detail: 'A credential-looking value is assigned a string literal directly in source. Secrets in code leak through git history, logs, and client bundles.',
    fix: 'Move the value to an environment variable or a secrets manager and reference it at runtime. Rotate the exposed credential.',
    pattern: /\b(api[_-]?key|secret|password|passwd|token|client[_-]?secret|private[_-]?key|access[_-]?key|auth[_-]?token)\s*[:=]\s*["'`]([^"'`]{8,})["'`]/i,
    evidenceGroup: 2,
    ignoreIf: (line, m) => PLACEHOLDER.test(m[2] ?? '') || PLACEHOLDER.test(line),
  },
  {
    id: 'aws-access-key',
    title: 'AWS access key ID in source',
    severity: 'critical',
    criterion: 'confidentiality',
    detail: 'A string matching the AWS access key ID format (AKIA…) is present in source.',
    fix: 'Remove it, rotate the key in IAM immediately, and load AWS credentials from the environment or instance role.',
    pattern: /\b((?:AKIA|ASIA)[0-9A-Z]{16})\b/,
  },
  {
    id: 'provider-secret',
    title: 'Live provider credential in source',
    severity: 'critical',
    criterion: 'confidentiality',
    detail: 'A token matching a known provider format (Stripe live key, GitHub PAT, Google API key, Slack token, GitLab PAT, etc.) is embedded in source.',
    fix: 'Remove it, rotate the key with the provider immediately, and load it from a secret store at runtime.',
    pattern: /\b(sk_live_[A-Za-z0-9]{16,}|rk_live_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{36}|gho_[A-Za-z0-9]{36}|ghs_[A-Za-z0-9]{36}|github_pat_[A-Za-z0-9_]{30,}|xox[baprs]-[A-Za-z0-9-]{10,}|AIza[0-9A-Za-z_\-]{35}|glpat-[A-Za-z0-9_\-]{20}|AAAA[A-Za-z0-9_\-]{20,})\b/,
    ignoreIf: (text) => PLACEHOLDER.test(text),
  },
  {
    id: 'jwt-hardcoded',
    title: 'Hardcoded JSON Web Token',
    severity: 'medium',
    criterion: 'confidentiality',
    detail: 'A literal JWT (header.payload.signature) is embedded in source. If it is a real token it grants whatever access it was minted for until it expires.',
    fix: 'Never commit JWTs. Issue them at runtime and store them in memory / secure storage, not source.',
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{8,}/,
    ignoreIf: (text) => PLACEHOLDER.test(text),
  },
  {
    id: 'private-key-block',
    title: 'Private key material in source',
    severity: 'critical',
    criterion: 'confidentiality',
    detail: 'A PEM private key block is embedded in source code.',
    fix: 'Remove the key from the repo, rotate it, and load it from a secret store at runtime.',
    pattern: /-----BEGIN (RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
  },
  {
    id: 'plaintext-http',
    title: 'Plaintext HTTP endpoint',
    severity: 'medium',
    criterion: 'security',
    detail: 'A non-TLS http:// URL is used for a request. Data in transit is unencrypted and tamperable.',
    fix: 'Use https:// for all external calls. Enforce TLS and reject downgrade.',
    pattern: /["'`](http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0)[^"'`\s]+)["'`]/i,
    evidenceGroup: 1,
    ignoreIf: (_text, m) => SCHEMA_URL.test(m[1] ?? ''),
  },
  {
    id: 'dangerous-eval',
    title: 'Dynamic code execution sink',
    severity: 'high',
    criterion: 'integrity',
    detail: 'Use of eval / Function constructor / child_process with interpolated input enables code or command injection.',
    fix: 'Avoid eval and dynamic Function. For shell calls use a fixed argv array and never interpolate untrusted input.',
    pattern: /\b(eval\s*\(|new\s+Function\s*\(|child_process|exec\s*\(|execSync\s*\(|os\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True)/,
  },
  {
    id: 'weak-hash',
    title: 'Weak hashing algorithm',
    severity: 'medium',
    criterion: 'security',
    detail: 'MD5 or SHA-1 are cryptographically broken and must not be used for passwords, signatures, or integrity checks.',
    fix: 'Use bcrypt/argon2/scrypt for passwords and SHA-256+ for integrity.',
    // Only flag MD5/SHA-1 used in a crypto context — not bare mentions in
    // comments, variable names, or checksum-display code.
    pattern: /(createHash\s*\(\s*["'`](?:md5|sha1)|hashlib\.(?:md5|sha1)\s*\(|MessageDigest\.getInstance\s*\(\s*["'`](?:MD5|SHA-?1)|crypto\.createHash\s*\(\s*["'`](?:md5|sha1)|(?:algorithm|digest|hash)\s*[:=]\s*["'`](?:md5|sha1)["'`])/i,
    ignoreIf: (line) => /sha1sum|gravatar|etag|cache[_-]?key|checksum/i.test(line),
  },
  {
    id: 'insecure-cookie',
    title: 'Cookie set without security flags',
    severity: 'medium',
    criterion: 'confidentiality',
    detail: 'A cookie appears to be set without HttpOnly / Secure / SameSite, exposing session tokens to XSS and interception.',
    fix: 'Set HttpOnly, Secure, and SameSite=Lax (or Strict) on all session/auth cookies.',
    pattern: /\b(set-?cookie|cookies?\.set|res\.cookie)\b/i,
    ignoreIf: (line) => /httponly|secure|samesite/i.test(line),
  },
  {
    id: 'tls-verify-disabled',
    title: 'TLS certificate verification disabled',
    severity: 'high',
    criterion: 'security',
    detail: 'Certificate validation is turned off, allowing man-in-the-middle attacks on encrypted connections.',
    fix: 'Never disable TLS verification in production. Fix the trust store instead.',
    pattern: /(rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["'`]?0|InsecureSkipVerify\s*:\s*true|CURLOPT_SSL_VERIFYPEER\s*,\s*(?:false|0))/i,
  },
  {
    id: 'debug-enabled',
    title: 'Debug mode enabled',
    severity: 'medium',
    criterion: 'security',
    detail: 'A framework debug mode is hardcoded on. Debug modes expose stack traces, source, and (in Flask/Werkzeug) an interactive console — a remote code execution risk in production.',
    fix: 'Drive debug from an environment variable and default it OFF. Never ship debug=True / DEBUG=True to production.',
    pattern: /(\.run\([^)]*debug\s*=\s*True|app\.debug\s*=\s*(?:true|True)|^\s*DEBUG\s*=\s*True|FLASK_DEBUG\s*=\s*1)/,
  },
  {
    id: 'sql-string-concat',
    title: 'Possible SQL injection via string building',
    severity: 'high',
    criterion: 'integrity',
    detail: 'A SQL statement appears to be assembled with string concatenation or template interpolation, which enables SQL injection.',
    fix: 'Use parameterized queries / prepared statements. Never interpolate user input into SQL text.',
    pattern: /\b(select|insert|update|delete)\b[^;]*(\+\s*\w+|\$\{[^}]+\}|%\s*\w+|f["'`])/i,
    ignoreIf: (line) => /sql`/.test(line), // tagged template (postgres.js) is safe
  },
  // ── Multi-line / whole-file rules (scope: 'file') ──────────────────────────
  {
    id: 'sql-string-concat',
    title: 'Possible SQL injection via string building',
    severity: 'high',
    criterion: 'integrity',
    detail: 'A SQL query passed to a database call is assembled across lines with string concatenation or interpolation, which enables SQL injection.',
    fix: 'Use parameterized queries / prepared statements. Never interpolate user input into SQL text.',
    scope: 'file',
    // query/execute( "....SELECT ..." <within ~200 chars> + var | ${...} )
    pattern: /(?:execute|query|prepare|cursor\.execute|db\.(?:query|raw))\s*\(\s*["'`][^"'`]*\b(?:select|insert|update|delete)\b[\s\S]{0,200}?(?:["'`]\s*\+\s*\w|\$\{)/gi,
    ignoreIf: (text) => /sql`|\?\s*[,)]|\$\d/.test(text), // parameterized
  },
  {
    id: 'cors-wildcard-credentials',
    title: 'CORS allows any origin with credentials',
    severity: 'high',
    criterion: 'security',
    detail: 'CORS is configured to reflect/allow any origin (*) together with credentials. Any site can then make authenticated cross-origin requests on a victim user’s behalf.',
    fix: 'Allow-list specific trusted origins; never combine a wildcard origin with credentials:true / Access-Control-Allow-Credentials.',
    scope: 'file',
    pattern: /(?:origin\s*:\s*["'`]\*["'`][\s\S]{0,120}?credentials\s*:\s*true|credentials\s*:\s*true[\s\S]{0,120}?origin\s*:\s*["'`]\*["'`]|access-control-allow-origin["'`\s:,]+\*[\s\S]{0,160}?access-control-allow-credentials["'`\s:,]+true)/gi,
  },
];

const LINE_RULES = RULES.filter(r => r.scope !== 'file');
const FILE_RULES = RULES.filter(r => r.scope === 'file');

// Cap whole-file regex scanning so a giant minified blob can't blow the budget.
const MAX_FILE_SCAN_CHARS = 200_000;

function lineNumberAt(content: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index && i < content.length; i++) {
    if (content.charCodeAt(i) === 10) line++;
  }
  return line;
}

export interface StaticResult {
  findings: Finding[];
  filesScanned: number;
  linesScanned: number;
}

export function runStaticChecks(files: CodeFile[]): StaticResult {
  const findings: Finding[] = [];
  const seen = new Set<string>(); // dedupe by id+evidence
  let linesScanned = 0;

  const pushFinding = (rule: Rule, evidence: string) => {
    const key = `${rule.id}|${evidence}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push({
      id: rule.id,
      title: rule.title,
      severity: rule.severity,
      criterion: rule.criterion,
      detail: rule.detail,
      fix: rule.fix,
      evidence,
      source: 'static',
    });
  };

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    linesScanned += lines.length;

    // ── Per-line rules ──
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4000) continue; // skip minified blobs
      for (const rule of LINE_RULES) {
        const m = line.match(rule.pattern);
        if (!m) continue;
        if (rule.ignoreIf?.(line, m)) continue;
        const ev = m[rule.evidenceGroup ?? -1] ?? m[1] ?? m[0];
        pushFinding(rule, `${file.path}:${i + 1} — ${redact(ev)}`);
      }
    }

    // ── Whole-file (multi-line) rules ──
    if (file.content.length <= MAX_FILE_SCAN_CHARS) {
      for (const rule of FILE_RULES) {
        const flags = rule.pattern.flags.includes('g') ? rule.pattern.flags : rule.pattern.flags + 'g';
        const re = new RegExp(rule.pattern.source, flags);
        let m: RegExpExecArray | null;
        while ((m = re.exec(file.content)) !== null) {
          if (m.index === re.lastIndex) re.lastIndex++; // guard against zero-length matches
          if (rule.ignoreIf?.(m[0], m)) continue;
          const ev = m[rule.evidenceGroup ?? -1] ?? m[1] ?? m[0];
          const lineNo = lineNumberAt(file.content, m.index);
          pushFinding(rule, `${file.path}:${lineNo} — ${redact(ev)}`);
        }
      }
    }
  }

  return { findings, filesScanned: files.length, linesScanned };
}
