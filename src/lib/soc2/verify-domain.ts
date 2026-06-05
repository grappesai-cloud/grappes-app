// ── SOC 2 Live Pentest — domain ownership verification ─────────────────────
// Nothing active runs against a domain until the user proves they control it.
// Two methods, user's choice:
//   • dns_txt — a TXT record `grappes-verify=<token>` on the domain
//   • file    — a file at https://<domain>/.well-known/grappes-verify-<token>.txt
// This is the gate that keeps the live scanner from touching third-party sites.

import { promises as dns } from 'node:dns';
import { randomBytes } from 'node:crypto';

export type VerifyMethod = 'dns_txt' | 'file';

// A registrable hostname: labels of [a-z0-9-], a dot, a TLD. No scheme/path/port.
const HOSTNAME_RE = /^(?=.{1,253}$)([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Normalize user input to a bare lowercase hostname.
 * Strips scheme, path, query, port, leading `www.`, and a trailing dot.
 * Returns null if the result isn't a valid public hostname.
 */
export function normalizeDomain(input: string): string | null {
  if (!input) return null;
  let host = input.trim().toLowerCase();
  // strip scheme
  host = host.replace(/^[a-z][a-z0-9+.-]*:\/\//, '');
  // strip path / query / fragment
  host = host.split(/[/?#]/)[0];
  // strip credentials and port
  host = host.split('@').pop() ?? host;
  host = host.split(':')[0];
  // strip trailing dot and leading www.
  host = host.replace(/\.$/, '').replace(/^www\./, '');
  if (!HOSTNAME_RE.test(host)) return null;
  // reject obvious non-public targets
  if (host === 'localhost' || /\.local$/.test(host)) return null;
  return host;
}

export function generateToken(): string {
  // URL- and DNS-safe, ~26 chars
  return randomBytes(16).toString('hex');
}

export function dnsRecordValue(token: string): string {
  return `grappes-verify=${token}`;
}

export function wellKnownPath(token: string): string {
  return `/.well-known/grappes-verify-${token}.txt`;
}

export interface CheckResult {
  ok: boolean;
  detail: string;
}

/** Look for `grappes-verify=<token>` among the domain's TXT records. */
export async function checkDnsTxt(domain: string, token: string): Promise<CheckResult> {
  const target = dnsRecordValue(token);
  try {
    const records = await dns.resolveTxt(domain);
    const flat = records.map(chunks => chunks.join('').trim());
    if (flat.includes(target)) return { ok: true, detail: 'TXT record found.' };
    // also accept the bare token in case the user dropped the prefix
    if (flat.includes(token)) return { ok: true, detail: 'TXT token found.' };
    return { ok: false, detail: `No matching TXT record yet. Found ${flat.length} record(s). DNS can take a few minutes to propagate.` };
  } catch (e: any) {
    if (e?.code === 'ENOTFOUND' || e?.code === 'ENODATA') {
      return { ok: false, detail: 'No TXT records found for this domain yet.' };
    }
    return { ok: false, detail: 'DNS lookup failed. Try again in a moment.' };
  }
}

/** Fetch the well-known file over HTTPS and confirm it contains the token. */
export async function checkFile(domain: string, token: string): Promise<CheckResult> {
  const url = `https://${domain}${wellKnownPath(token)}`;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      method: 'GET',
      redirect: 'manual', // a redirect away from the path is not proof of control
      signal: ctrl.signal,
      headers: { 'User-Agent': 'grappes-soc2-verify' },
    });
    clearTimeout(timer);
    if (res.status >= 300 && res.status < 400) {
      return { ok: false, detail: 'The verification URL redirects; serve the file directly at the exact path.' };
    }
    if (!res.ok) return { ok: false, detail: `File not reachable (HTTP ${res.status}).` };
    const body = (await res.text()).trim();
    if (body.includes(token)) return { ok: true, detail: 'Verification file found.' };
    return { ok: false, detail: 'File found but token did not match.' };
  } catch (e: any) {
    if (e?.name === 'AbortError') return { ok: false, detail: 'Request timed out fetching the file.' };
    return { ok: false, detail: 'Could not reach the verification file over HTTPS.' };
  }
}

export function runCheck(method: VerifyMethod, domain: string, token: string): Promise<CheckResult> {
  return method === 'dns_txt' ? checkDnsTxt(domain, token) : checkFile(domain, token);
}
