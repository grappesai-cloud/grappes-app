// Local integration test for SOC 2 Lab — runs the REAL pipeline modules
// (code audit, live recon, domain verify) without the worker, the HTTP layer,
// or the browser. Makes live Claude + network calls, so it's gated behind
// SOC2_LIVE=1 and only runs when ANTHROPIC_API_KEY is present in .env.
//
//   SOC2_LIVE=1 npx vitest run tests/soc2-integration.test.ts
//
import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

// Load ANTHROPIC_API_KEY from .env into process.env so lib/env.ts `e()` resolves
// it (via its process.env fallback) when the anthropic client initializes.
function loadEnvKey(name: string): string {
  try {
    const line = readFileSync('.env', 'utf8').split(/\r?\n/).find(l => l.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch {
    return '';
  }
}

const LIVE = process.env.SOC2_LIVE === '1';

beforeAll(() => {
  if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = loadEnvKey('ANTHROPIC_API_KEY');
});

describe.skipIf(!LIVE)('SOC 2 Lab — local integration (no worker)', () => {
  it('domain verify: normalizes input and degrades gracefully on DNS', async () => {
    const { normalizeDomain, checkDnsTxt } = await import('../src/lib/soc2/verify-domain');
    expect(normalizeDomain('https://www.Example.com/path?q=1')).toBe('example.com');
    expect(normalizeDomain('localhost')).toBeNull();
    const res = await checkDnsTxt('example.com', 'token-that-will-not-exist-zzz');
    expect(res.ok).toBe(false); // no matching record, but no throw
  });

  it('code audit: flags injected vulnerabilities and scores by TSC', async () => {
    const { runCodeAudit } = await import('../src/lib/soc2/code-audit');
    const report = await runCodeAudit([{
      path: 'app.js',
      content: [
        'const API_KEY = "sk_live_abc123def456ghi789jkl";',
        'app.get("/user/:id", (req,res) => {',
        '  const q = "SELECT * FROM users WHERE id = " + req.params.id;',
        '  db.query(q).then(r => res.json(r));',
        '});',
        'fetch("http://api.internal/sync");',
      ].join('\n'),
    }]);

    expect(report.mode).toBe('code');
    expect(report.findings.length).toBeGreaterThan(0);
    // static pre-pass must catch the hardcoded secret deterministically
    expect(report.findings.some(f => f.id.includes('secret') || /secret|key/i.test(f.title))).toBe(true);
    // scores are valid 0..100
    for (const v of Object.values(report.scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    expect(report.scores.overall).toBeLessThan(80); // clearly not clean
    expect(report.disclaimer).toMatch(/not a SOC 2/i);
    // Every finding carries the SOC 2 / ISO 27001 / NIST crosswalk.
    expect(report.findings.every(f => f.frameworks?.soc2?.length && f.frameworks?.iso27001?.length)).toBe(true);
  }, 120_000); // the holistic Claude pass with a rich prompt can exceed 60s

  it('live recon: produces a TSC report against a real domain', async () => {
    const { runLiveScan } = await import('../src/lib/soc2/live-scan');
    const report = await runLiveScan('example.com');

    expect(report.mode).toBe('live');
    expect(Array.isArray(report.findings)).toBe(true);
    expect(report.scanLog.length).toBeGreaterThan(0);          // it actually probed
    expect(report.scanLog.some(e => e.target === '/')).toBe(true);
    expect(report.scanLog.some(e => String(e.target).includes('TLS'))).toBe(true);
    for (const v of Object.values(report.scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  }, 60_000);
});
