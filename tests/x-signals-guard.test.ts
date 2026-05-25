import { describe, it, expect } from 'vitest';
import { computeXRankingSignals } from '../src/lib/reels/x-signals';
import type { AnalysisResult } from '../src/lib/reels/types';

// Minimal but complete-enough result, mirroring a real stored analysis.
function makeResult(): AnalysisResult {
  const dim = { score: 50, timeline: [], moments: [], summary: 's' };
  return {
    meta: { duration_sec: 30 },
    hook: { score: 60, grabs_attention_at_sec: 2 },
    cta: { present: true, type: 'follow', timing_sec: 25, strength: 70, issue: '', suggestion: null },
    retention_estimate: { curve: [{ sec: 0, retention_pct: 100 }, { sec: 30, retention_pct: 40 }], drop_points: [], overall_score: 55 },
    niche: { niche: 'fitness', confidence: 80 },
    dimensions: {
      voice_impact: { ...dim },
      visual_pull: { ...dim },
      emotional_hit: { ...dim },
      cognitive_grip: { ...dim },
      memorability: { ...dim },
    },
    engagement: { timeline: [], moments: [] },
    overall: { score: 65, verdict: 'ok', weaknesses: [], top_3_actions: [] },
  } as unknown as AnalysisResult;
}

describe('computeXRankingSignals resilience (regression for prod SSR crash)', () => {
  it('does not throw on a complete result', () => {
    expect(() => computeXRankingSignals(makeResult())).not.toThrow();
  });

  it('does not throw when dimensions object is missing sub-dimensions (the 1Maca crash)', () => {
    const r = makeResult();
    // Reproduce the exact prod data shape: dimensions present, sub-dims absent.
    (r as any).dimensions = { cognitive_grip: { score: 40, timeline: [], moments: [], summary: 's' } };
    expect(() => computeXRankingSignals(r)).not.toThrow();
  });

  it('does not throw when dimensions / overall / meta are entirely absent', () => {
    const r = makeResult();
    delete (r as any).dimensions;
    delete (r as any).overall;
    delete (r as any).meta;
    expect(() => computeXRankingSignals(r)).not.toThrow();
  });
});
