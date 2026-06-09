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
  source: 'static' | 'ai' | 'questionnaire' | 'mcp';
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
  // regex run per-line; capture group 1 (if present) is used as evidence
  pattern: RegExp;
  // optional guard to drop false positives (e.g. obvious placeholders)
  ignoreIf?: (line: string, match: RegExpMatchArray) => boolean;
}

const PLACEHOLDER = /(your[_-]?|example|placeholder|xxx+|<.*>|changeme|dummy|test[_-]?key|sk_test_|process\.env|import\.meta\.env|getenv|os\.environ)/i;

const RULES: Rule[] = [
  {
    id: 'hardcoded-secret-assignment',
    title: 'Hardcoded secret in source',
    severity: 'critical',
    criterion: 'confidentiality',
    detail: 'A credential-looking value is assigned a string literal directly in source. Secrets in code leak through git history, logs, and client bundles.',
    fix: 'Move the value to an environment variable or a secrets manager and reference it at runtime. Rotate the exposed credential.',
    pattern: /\b(api[_-]?key|secret|password|passwd|token|client[_-]?secret|private[_-]?key|access[_-]?key|auth[_-]?token)\s*[:=]\s*["'`]([^"'`]{8,})["'`]/i,
    ignoreIf: (line, m) => PLACEHOLDER.test(m[2] ?? '') || PLACEHOLDER.test(line),
  },
  {
    id: 'aws-access-key',
    title: 'AWS access key ID in source',
    severity: 'critical',
    criterion: 'confidentiality',
    detail: 'A string matching the AWS access key ID format (AKIA…) is present in source.',
    fix: 'Remove it, rotate the key in IAM immediately, and load AWS credentials from the environment or instance role.',
    pattern: /\b(AKIA[0-9A-Z]{16})\b/,
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
  },
  {
    id: 'dangerous-eval',
    title: 'Dynamic code execution sink',
    severity: 'high',
    criterion: 'integrity',
    detail: 'Use of eval / Function constructor / child_process with interpolated input enables code or command injection.',
    fix: 'Avoid eval and dynamic Function. For shell calls use a fixed argv array and never interpolate untrusted input.',
    pattern: /\b(eval\s*\(|new\s+Function\s*\(|child_process|exec\s*\(|execSync\s*\(|os\.system\s*\()/,
  },
  {
    id: 'weak-hash',
    title: 'Weak hashing algorithm',
    severity: 'medium',
    criterion: 'security',
    detail: 'MD5 or SHA-1 are cryptographically broken and must not be used for passwords, signatures, or integrity checks.',
    fix: 'Use bcrypt/argon2/scrypt for passwords and SHA-256+ for integrity. ',
    pattern: /\b(md5|sha1)\b/i,
    ignoreIf: (line) => /sha1sum|gravatar/i.test(line),
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
    pattern: /(rejectUnauthorized\s*:\s*false|verify\s*=\s*False|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["'`]?0|InsecureSkipVerify\s*:\s*true)/i,
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
];

export interface StaticResult {
  findings: Finding[];
  filesScanned: number;
  linesScanned: number;
}

export function runStaticChecks(files: CodeFile[]): StaticResult {
  const findings: Finding[] = [];
  const seen = new Set<string>(); // dedupe by id+evidence
  let linesScanned = 0;

  for (const file of files) {
    const lines = file.content.split(/\r?\n/);
    linesScanned += lines.length;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.length > 4000) continue; // skip minified blobs
      for (const rule of RULES) {
        const m = line.match(rule.pattern);
        if (!m) continue;
        if (rule.ignoreIf?.(line, m)) continue;
        const ev = m[2] ?? m[1] ?? m[0];
        const evidence = `${file.path}:${i + 1} — ${redact(ev)}`;
        const key = `${rule.id}|${evidence}`;
        if (seen.has(key)) continue;
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
      }
    }
  }

  return { findings, filesScanned: files.length, linesScanned };
}
