import { describe, it, expect } from 'vitest';
import { ensureCompleteDimensions } from '../src/lib/reels/normalize';
import { computeXRankingSignals } from '../src/lib/reels/x-signals';
import type { AnalysisResult } from '../src/lib/reels/types';

const dim = () => ({ score: 72, timeline: [{ sec: 0, value: 50 }], moments: [], summary: 'ok' });
const seq = () => ({ score: 64, summary: 'ok' });

function completeResult(): AnalysisResult {
  return {
    overall: { score: 68, verdict: 'v', weaknesses: [], top_3_actions: [] },
    dimensions: {
      voice_impact: dim(),
      visual_pull: dim(),
      emotional_hit: dim(),
      cognitive_grip: seq(),
      memorability: seq(),
    },
  } as unknown as AnalysisResult;
}

describe('ensureCompleteDimensions', () => {
  it('recovers missing sub-dimensions from the first-pass fallback', () => {
    const initial = completeResult();
    const critiqued = completeResult();
    // Simulate a truncated critique that dropped two dimensions.
    delete (critiqued as any).dimensions.voice_impact;
    delete (critiqued as any).dimensions.cognitive_grip;

    ensureCompleteDimensions(critiqued, initial);

    // Recovered from the first pass, not synthesized.
    expect(critiqued.dimensions.voice_impact.score).toBe(72);
    expect(critiqued.dimensions.cognitive_grip.score).toBe(64);
    // All five present.
    for (const k of ['voice_impact', 'visual_pull', 'emotional_hit', 'cognitive_grip', 'memorability'] as const) {
      expect(typeof critiqued.dimensions[k].score).toBe('number');
    }
  });

  it('synthesizes from overall.score when neither result nor fallback has the dimension', () => {
    const r = completeResult();
    delete (r as any).dimensions; // entirely missing
    const emptyFallback = { overall: { score: 50 } } as unknown as AnalysisResult;

    ensureCompleteDimensions(r, emptyFallback);

    expect(r.dimensions.voice_impact.score).toBe(68); // r.overall.score
    expect(r.dimensions.memorability.score).toBe(68);
    expect(Array.isArray(r.dimensions.visual_pull.timeline)).toBe(true);
  });

  it('output is safe to feed into computeXRankingSignals (no throw)', () => {
    const r = completeResult();
    (r as any).dimensions = {}; // present but empty, the original crash shape
    (r as any).meta = { duration_sec: 30 };
    (r as any).retention_estimate = { curve: [], drop_points: [], overall_score: 50 };
    (r as any).engagement = { timeline: [], moments: [] };
    ensureCompleteDimensions(r, completeResult());
    expect(() => computeXRankingSignals(r)).not.toThrow();
  });
});
