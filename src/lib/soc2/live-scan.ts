// ── SOC 2 Live Pentest — recon layer ───────────────────────────────────────
// Active, non-destructive reconnaissance against a domain the user has VERIFIED
// and AUTHORIZED. Sends real requests (security headers, TLS, DNS, exposed-file
// probes, legal pages) and maps results to the Trust Service Criteria.
//
// The aggressive offensive layer (auth/IDOR/injection fuzzing) is intentionally
// NOT here — that runs in the standalone Python worker. This module is the safe,
// self-serve recon that ships in-app.

import { promises as dns } from 'node:dns';
import tls from 'node:tls';
import { createMessage } from '../anthropic';
import type { Finding, Severity, TSC } from './static-checks';
import { tagFindings, type TaggedFinding } from './framework-map';

const SONNET_MODEL = 'claude-sonnet-4-6';
const REQ_TIMEOUT = 8000;
const UA = 'grappes-soc2-scan/1.0 (+authorized security assessment)';

const SEVERITY_WEIGHT: Record<Severity, number> = {
  critical: 25, high: 15, medium: 8, low: 3, info: 0,
};

export interface ScanLogEntry { target: string; status: number | string; note?: string; }

export interface LiveScanReport {
  mode: 'live';
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
  roadmap: { priority: number; title: string; detail: string; criterion: TSC; effort: 'low' | 'medium' | 'high' }[];
  scanLog: ScanLogEntry[];
  disclaimer: string;
}

const DISCLAIMER =
  'Authorized readiness scan, non-destructive recon only. This is not a SOC 2 audit or attestation, nor a full penetration test; deeper offensive testing and the formal audit are separate engagements.';

function f(
  id: string, title: string, severity: Severity, criterion: TSC, detail: string, fix: string, evidence?: string,
): Finding {
  return { id, title, severity, criterion, detail, fix, evidence, source: 'static' };
}

async function timedFetch(
  url: string,
  method: 'GET' | 'HEAD' = 'GET',
  redirect: 'manual' | 'follow' = 'manual',
): Promise<Response | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), REQ_TIMEOUT);
  try {
    return await fetch(url, {
      method,
      redirect,
      signal: ctrl.signal,
      headers: { 'User-Agent': UA },
    });
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

// ── TLS certificate probe (real handshake on :443) ─────────────────────────
function probeTls(domain: string): Promise<{ ok: boolean; protocol?: string; daysLeft?: number; detail: string }> {
  return new Promise((resolve) => {
    const socket = tls.connect(
      { host: domain, port: 443, servername: domain, timeout: REQ_TIMEOUT, rejectUnauthorized: false },
      () => {
        const cert = socket.getPeerCertificate();
        const protocol = socket.getProtocol() ?? undefined;
        const authorized = socket.authorized;
        let daysLeft: number | undefined;
        if (cert?.valid_to) {
          daysLeft = Math.floor((new Date(cert.valid_to).getTime() - Date.now()) / 86_400_000);
        }
        socket.end();
        resolve({ ok: authorized, protocol, daysLeft, detail: authorized ? 'Valid certificate.' : 'Certificate not trusted.' });
      },
    );
    socket.on('error', () => resolve({ ok: false, detail: 'TLS handshake failed.' }));
    socket.on('timeout', () => { socket.destroy(); resolve({ ok: false, detail: 'TLS handshake timed out.' }); });
  });
}

// ── Security response headers ──────────────────────────────────────────────
function analyzeHeaders(h: Headers): Finding[] {
  const out: Finding[] = [];
  const has = (k: string) => h.has(k);

  if (!has('strict-transport-security')) {
    out.push(f('missing-hsts', 'No HSTS header', 'medium', 'security',
      'Strict-Transport-Security is absent, so browsers may downgrade to HTTP and are exposed to SSL-stripping.',
      'Add `Strict-Transport-Security: max-age=63072000; includeSubDomains; preload`.'));
  }
  if (!has('content-security-policy')) {
    out.push(f('missing-csp', 'No Content-Security-Policy', 'medium', 'security',
      'Without a CSP, injected scripts (XSS) run with no restriction on sources.',
      'Define a Content-Security-Policy, starting in report-only mode and tightening sources.'));
  }
  if (!has('x-frame-options') && !/frame-ancestors/i.test(h.get('content-security-policy') ?? '')) {
    out.push(f('missing-frame-options', 'Clickjacking protection missing', 'low', 'security',
      'No X-Frame-Options or CSP frame-ancestors, so the site can be framed for clickjacking.',
      'Set `X-Frame-Options: DENY` or a CSP `frame-ancestors` directive.'));
  }
  if ((h.get('x-content-type-options') ?? '').toLowerCase() !== 'nosniff') {
    out.push(f('missing-nosniff', 'MIME sniffing not disabled', 'low', 'security',
      'Missing `X-Content-Type-Options: nosniff` lets browsers MIME-sniff responses.',
      'Set `X-Content-Type-Options: nosniff`.'));
  }
  if (!has('referrer-policy')) {
    out.push(f('missing-referrer-policy', 'No Referrer-Policy', 'low', 'privacy',
      'Without a Referrer-Policy, full URLs may leak to third parties via the Referer header.',
      'Set `Referrer-Policy: strict-origin-when-cross-origin`.'));
  }
  const leaky = ['server', 'x-powered-by', 'x-aspnet-version'].filter(k => has(k)).map(k => `${k}: ${h.get(k)}`);
  if (leaky.length) {
    out.push(f('version-disclosure', 'Server version disclosed', 'low', 'confidentiality',
      'Response headers reveal server/framework versions, helping attackers target known CVEs.',
      'Strip or genericize Server / X-Powered-By headers.', leaky.join('; ')));
  }
  return out;
}

// ── Cookie flags ───────────────────────────────────────────────────────────
function analyzeCookies(h: Headers): Finding[] {
  // Headers.getSetCookie() returns the array of Set-Cookie values (Node 20+)
  const cookies: string[] = (h as any).getSetCookie?.() ?? (h.get('set-cookie') ? [h.get('set-cookie')!] : []);
  const out: Finding[] = [];
  for (const c of cookies) {
    const name = c.split('=')[0]?.trim() ?? 'cookie';
    const flags = c.toLowerCase();
    const missing: string[] = [];
    if (!/;\s*secure/.test(flags)) missing.push('Secure');
    if (!/;\s*httponly/.test(flags)) missing.push('HttpOnly');
    if (!/;\s*samesite/.test(flags)) missing.push('SameSite');
    if (missing.length) {
      out.push(f(`cookie-flags-${name}`, `Cookie '${name}' missing ${missing.join(', ')}`,
        missing.includes('HttpOnly') ? 'medium' : 'low', 'confidentiality',
        `The cookie '${name}' is set without ${missing.join(', ')}, exposing it to theft via XSS or interception.`,
        'Set Secure, HttpOnly and SameSite=Lax (or Strict) on session/auth cookies.', name));
    }
  }
  return out;
}

// ── DNS email authentication ───────────────────────────────────────────────
async function analyzeDns(domain: string): Promise<Finding[]> {
  const out: Finding[] = [];
  try {
    const txt = (await dns.resolveTxt(domain)).map(c => c.join(''));
    if (!txt.some(r => /^v=spf1/i.test(r.trim()))) {
      out.push(f('missing-spf', 'No SPF record', 'medium', 'integrity',
        'No SPF record, so attackers can spoof email from this domain.',
        'Publish an SPF TXT record listing authorized senders, ending in `-all`.'));
    }
  } catch {
    out.push(f('missing-spf', 'No SPF record', 'medium', 'integrity',
      'No SPF record found; the domain is vulnerable to email spoofing.',
      'Publish an SPF TXT record listing authorized senders.'));
  }
  try {
    const dmarc = (await dns.resolveTxt(`_dmarc.${domain}`)).map(c => c.join(''));
    if (!dmarc.some(r => /^v=DMARC1/i.test(r.trim()))) {
      out.push(f('missing-dmarc', 'No DMARC policy', 'medium', 'integrity',
        'No DMARC policy, so spoofed mail is not reported or rejected.',
        'Publish a DMARC TXT record at `_dmarc` starting at `p=none` then move to `quarantine`/`reject`.'));
    }
  } catch {
    out.push(f('missing-dmarc', 'No DMARC policy', 'medium', 'integrity',
      'No DMARC record found at `_dmarc`; spoofed mail is neither monitored nor rejected.',
      'Publish a DMARC TXT record at `_dmarc`.'));
  }
  return out;
}

// ── Exposed sensitive files ────────────────────────────────────────────────
const EXPOSED_PATHS: { path: string; title: string; severity: Severity; criterion: TSC }[] = [
  { path: '/.env', title: 'Environment file exposed', severity: 'critical', criterion: 'confidentiality' },
  { path: '/.git/HEAD', title: 'Git repository exposed', severity: 'high', criterion: 'confidentiality' },
  { path: '/.git/config', title: 'Git config exposed', severity: 'high', criterion: 'confidentiality' },
  { path: '/config.json', title: 'Config file exposed', severity: 'high', criterion: 'confidentiality' },
  { path: '/backup.sql', title: 'Database backup exposed', severity: 'critical', criterion: 'confidentiality' },
  { path: '/backup.zip', title: 'Backup archive exposed', severity: 'high', criterion: 'confidentiality' },
  { path: '/.DS_Store', title: 'Directory metadata exposed', severity: 'low', criterion: 'confidentiality' },
  { path: '/phpinfo.php', title: 'phpinfo() exposed', severity: 'medium', criterion: 'confidentiality' },
  { path: '/server-status', title: 'Apache server-status exposed', severity: 'medium', criterion: 'confidentiality' },
];

async function probeExposedFiles(base: string, log: ScanLogEntry[]): Promise<Finding[]> {
  const out: Finding[] = [];
  for (const p of EXPOSED_PATHS) {
    const url = base + p.path;
    const res = await timedFetch(url, 'GET');
    log.push({ target: p.path, status: res?.status ?? 'no-response' });
    if (res && res.status === 200) {
      // confirm it isn't an SPA catch-all returning HTML for everything
      const ct = res.headers.get('content-type') ?? '';
      const body = (await res.text()).slice(0, 400);
      const looksReal =
        (p.path === '/.git/HEAD' && /ref:\s*refs\//.test(body)) ||
        (p.path === '/.env' && /=/.test(body) && !/<html/i.test(body)) ||
        (p.path === '/.DS_Store' && /Bud1|\x00/.test(body)) ||
        (!/<html/i.test(body) && !ct.includes('text/html'));
      if (looksReal) {
        out.push(f(`exposed${p.path.replace(/\W+/g, '-')}`, p.title, p.severity, p.criterion,
          `${url} is publicly reachable (HTTP 200) and returns non-HTML content, indicating a real exposed artifact.`,
          'Block access to this path at the web server / CDN and remove the file from the document root.',
          `${p.path} → 200`));
      }
    }
  }
  return out;
}

// ── Legal / trust pages (readiness signals) ────────────────────────────────
async function probeTrustPages(base: string, log: ScanLogEntry[]): Promise<Finding[]> {
  const out: Finding[] = [];
  const privacy = await Promise.all(['/privacy', '/privacy-policy'].map(p => timedFetch(base + p, 'GET', 'follow')));
  if (!privacy.some(r => r && r.status === 200)) {
    log.push({ target: '/privacy', status: 'not found' });
    out.push(f('no-privacy-policy', 'No privacy policy found', 'low', 'privacy',
      'No privacy policy located at common paths. SOC 2 Privacy criteria expect a published policy.',
      'Publish a privacy policy describing data collection, use, and retention.'));
  }
  const sec = await timedFetch(base + '/.well-known/security.txt', 'GET', 'follow');
  log.push({ target: '/.well-known/security.txt', status: sec?.status ?? 'no-response' });
  if (!sec || sec.status !== 200) {
    out.push(f('no-security-txt', 'No security.txt', 'info', 'security',
      'No `/.well-known/security.txt`, so researchers have no disclosure channel.',
      'Publish a security.txt with a contact for vulnerability reports.'));
  }
  return out;
}

function deriveScore(findings: Finding[], criterion: TSC): number {
  const penalty = findings.filter(x => x.criterion === criterion).reduce((s, x) => s + (SEVERITY_WEIGHT[x.severity] ?? 0), 0);
  return Math.max(0, Math.min(100, 100 - penalty));
}

// Deterministic roadmap fallback: worst findings first.
function deterministicRoadmap(findings: Finding[]): LiveScanReport['roadmap'] {
  const order: Record<Severity, number> = { critical: 0, high: 1, medium: 2, low: 3, info: 4 };
  return [...findings]
    .sort((a, b) => order[a.severity] - order[b.severity])
    .slice(0, 8)
    .map((x, i) => ({ priority: i + 1, title: x.title, detail: x.fix, criterion: x.criterion, effort: 'medium' as const }));
}

export async function runLiveScan(domain: string): Promise<LiveScanReport> {
  const base = `https://${domain}`;
  const scanLog: ScanLogEntry[] = [];

  // Root request for headers/cookies + reachability. Follow redirects so we
  // analyze the headers of the FINAL page (apex→www, /→/lang are common) rather
  // than a 3xx hop, which would wrongly report security headers as missing.
  const root = await timedFetch(base, 'GET', 'follow');
  scanLog.push({ target: '/', status: root?.status ?? 'no-response' });

  const findings: Finding[] = [];

  // HTTP→HTTPS redirect check on the plaintext endpoint
  const httpRes = await timedFetch(`http://${domain}`, 'HEAD');
  scanLog.push({ target: 'http:// (redirect check)', status: httpRes?.status ?? 'no-response' });
  if (httpRes && !(httpRes.status >= 300 && httpRes.status < 400)) {
    findings.push(f('no-https-redirect', 'HTTP not redirected to HTTPS', 'medium', 'security',
      'The plaintext HTTP endpoint does not redirect to HTTPS, allowing unencrypted access.',
      'Force a 301 redirect from http:// to https:// for all paths.'));
  }

  // TLS
  const tlsRes = await probeTls(domain);
  scanLog.push({ target: 'TLS :443', status: tlsRes.ok ? `ok ${tlsRes.protocol ?? ''}`.trim() : 'fail', note: tlsRes.detail });
  if (!tlsRes.ok) {
    findings.push(f('tls-invalid', 'TLS certificate not trusted', 'high', 'security',
      tlsRes.detail, 'Install a valid certificate from a trusted CA and serve the full chain.'));
  } else {
    if (tlsRes.daysLeft !== undefined && tlsRes.daysLeft < 21) {
      findings.push(f('tls-expiring', `TLS certificate expires in ${tlsRes.daysLeft} days`, 'medium', 'availability',
        'The certificate is close to expiry; an expired cert causes a full outage.',
        'Automate renewal (e.g. ACME) well before expiry.'));
    }
    if (tlsRes.protocol && /TLSv1(\.0|\.1)?$/.test(tlsRes.protocol)) {
      findings.push(f('tls-legacy', `Legacy ${tlsRes.protocol} negotiated`, 'medium', 'security',
        'A deprecated TLS version was negotiated.', 'Disable TLS < 1.2 and prefer TLS 1.3.'));
    }
  }

  // Headers + cookies (only if we got a response)
  if (root) {
    findings.push(...analyzeHeaders(root.headers));
    findings.push(...analyzeCookies(root.headers));
  } else {
    findings.push(f('site-unreachable', 'Site did not respond over HTTPS', 'high', 'availability',
      'The HTTPS root returned no response within the timeout.',
      'Confirm the site is reachable and serving HTTPS.'));
  }

  // DNS, exposed files, trust pages — in parallel
  const [dnsF, exposedF, trustF] = await Promise.all([
    analyzeDns(domain),
    probeExposedFiles(base, scanLog),
    probeTrustPages(base, scanLog),
  ]);
  findings.push(...dnsF, ...exposedF, ...trustF);

  const scores = {
    security: deriveScore(findings, 'security'),
    availability: deriveScore(findings, 'availability'),
    confidentiality: deriveScore(findings, 'confidentiality'),
    integrity: deriveScore(findings, 'integrity'),
    privacy: deriveScore(findings, 'privacy'),
  };
  const overall = Math.round(
    scores.security * 0.4 + scores.confidentiality * 0.2 + scores.integrity * 0.15 +
    scores.availability * 0.15 + scores.privacy * 0.1,
  );

  // Claude writes a summary + prioritized roadmap from the findings. If it fails,
  // fall back to a deterministic roadmap so the scan never fully fails.
  let summary = `Recon scan of ${domain} complete: ${findings.length} finding${findings.length === 1 ? '' : 's'} across the Trust Service Criteria.`;
  let roadmap = deterministicRoadmap(findings);
  try {
    const msg = await createMessage({
      model: SONNET_MODEL,
      max_tokens: 2000,
      messages: [{
        role: 'user',
        content: `You are a SOC 2 readiness assessor turning an authorized external recon scan of ${domain} into a prioritized remediation plan. These findings come from a deterministic scanner (security headers, TLS, DNS email auth, exposed files, trust pages) — treat them as facts; do not invent new ones.

Return ONLY JSON: {"summary":"2-3 sentence readiness summary citing the most material gaps","roadmap":[{"priority":1,"title":"...","detail":"the concrete fix AND the SOC 2 control it closes (e.g. CC6.7 encryption in transit)","criterion":"security|availability|confidentiality|integrity|privacy","effort":"low|medium|high"}]}.
Order worst-first, group related header fixes into one item where sensible, and make each "detail" a concrete action (the exact header/record to add, e.g. "add 'Strict-Transport-Security: max-age=63072000; includeSubDomains; preload' at the edge/CDN"). Max 8 roadmap items.

Findings:
${findings.map(x => `- [${x.severity}] ${x.title} (${x.criterion})`).join('\n') || '(none — clean scan)'}`,
      }],
    });
    const text = msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text).join('');
    const j = JSON.parse(text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1));
    if (typeof j.summary === 'string') summary = j.summary;
    if (Array.isArray(j.roadmap) && j.roadmap.length) {
      roadmap = j.roadmap.slice(0, 8).map((r: any, i: number) => ({
        priority: typeof r.priority === 'number' ? r.priority : i + 1,
        title: String(r.title ?? ''),
        detail: String(r.detail ?? ''),
        criterion: (['security', 'availability', 'confidentiality', 'integrity', 'privacy'].includes(r.criterion) ? r.criterion : 'security') as TSC,
        effort: (['low', 'medium', 'high'].includes(r.effort) ? r.effort : 'medium') as 'low' | 'medium' | 'high',
      }));
    }
  } catch {
    // keep deterministic summary + roadmap
  }

  return {
    mode: 'live',
    summary,
    scores: { overall, ...scores },
    findings: tagFindings(findings),
    roadmap,
    scanLog,
    disclaimer: DISCLAIMER,
  };
}
