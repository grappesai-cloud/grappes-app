import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync } from 'node:fs';

function loadEnvKey(name: string): string {
  try {
    const line = readFileSync('.env', 'utf8').split(/\r?\n/).find(l => l.startsWith(name + '='));
    return line ? line.slice(name.length + 1).trim().replace(/^["']|["']$/g, '') : '';
  } catch { return ''; }
}
const LIVE = process.env.SOC2_LIVE === '1';
beforeAll(() => { if (!process.env.ANTHROPIC_API_KEY) process.env.ANTHROPIC_API_KEY = loadEnvKey('ANTHROPIC_API_KEY'); });

describe.skipIf(!LIVE)('SOC 2 controls self-assessment', () => {
  it('scores a mixed answer set, flags gaps, builds a roadmap', async () => {
    const { runControlsAudit } = await import('../src/lib/soc2/controls-audit');
    const report = await runControlsAudit({
      'security-policy': 'yes',
      'security-owner': 'yes',
      'mfa-enforced': 'no',          // critical gap
      'offboarding': 'partial',      // critical → softened to high
      'access-reviews': 'no',
      'logging': 'yes',
      'incident-plan': 'no',
      'backups': 'yes',
      'code-review': 'yes',
      'data-inventory': 'na',        // excluded
    });

    expect(report.mode).toBe('controls');
    for (const v of Object.values(report.scores)) {
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
    // MFA missing is critical → a critical finding must exist
    expect(report.findings.some(f => f.id === 'ctl-mfa-enforced' && f.severity === 'critical')).toBe(true);
    // partial offboarding softened critical→high
    expect(report.findings.some(f => f.id === 'ctl-offboarding' && f.severity === 'high')).toBe(true);
    // roadmap ordered, worst-first, capped at 8
    expect(report.roadmap.length).toBeGreaterThan(0);
    expect(report.roadmap.length).toBeLessThanOrEqual(8);
    expect(report.roadmap[0].priority).toBe(1);
    // coverage math
    expect(report.coverage.inPlace).toBe(5);  // yes answers (na excluded)
    expect(report.coverage.gaps).toBe(3);     // no answers
    expect(report.coverage.partial).toBe(1);
    expect(report.summary.length).toBeGreaterThan(10);
    expect(report.disclaimer).toMatch(/not a SOC 2/i);
    console.log('\nOVERALL:', report.scores.overall, '| scores:', JSON.stringify(report.scores));
    console.log('SUMMARY:', report.summary);
    console.log('FINDINGS:', report.findings.length, '| ROADMAP:', report.roadmap.map(r => r.priority + '.' + r.title.slice(0, 40)).join(' | '));
  }, 30_000);
});
