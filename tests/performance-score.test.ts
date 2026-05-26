import { describe, it, expect } from 'vitest';
import { performanceScore, computeXRankingSignals } from '../src/lib/reels/x-signals';
import type { AnalysisResult } from '../src/lib/reels/types';

// The real 666k-view talking-head reel: strong voice/memorability, weak visual.
function reel666k(): AnalysisResult {
  const d = (score: number) => ({ score, timeline: [], moments: [], summary: '' });
  return {
    overall: { score: 54, verdict: 'v', weaknesses: [], top_3_actions: [] },
    dimensions: {
      voice_impact: d(66),
      visual_pull: d(31),
      emotional_hit: d(54),
      cognitive_grip: { score: 61, summary: '' },
      memorability: { score: 60, summary: '' },
    },
  } as unknown as AnalysisResult;
}

describe('performanceScore (headline reweight quick-win)', () => {
  it('rates a verbally-carried viral reel higher than the craft gestalt', () => {
    const r = reel666k();
    const perf = performanceScore(r, 66); // heavy-ranker ~66 for this reel
    expect(perf).toBeGreaterThan(r.overall.score); // beats the "Mid 54"
    expect(perf).toBeGreaterThanOrEqual(62); // reads "Strong", not "Mid"
  });

  it('does not inflate a reel whose only strength is visual polish', () => {
    const d = (score: number) => ({ score, timeline: [], moments: [], summary: '' });
    const flashyButEmpty = {
      overall: { score: 54 },
      dimensions: {
        voice_impact: d(30),
        visual_pull: d(95), // gorgeous visuals
        emotional_hit: d(35),
        cognitive_grip: { score: 35, summary: '' },
        memorability: { score: 32, summary: '' },
      },
    } as unknown as AnalysisResult;
    // visual_pull is down-weighted, so high visuals alone stay mid/low.
    expect(performanceScore(flashyButEmpty, 45)).toBeLessThan(55);
  });

  it('computeXRankingSignals exposes a numeric performance_score', () => {
    const xs = computeXRankingSignals(reel666k());
    expect(typeof xs.performance_score).toBe('number');
  });
});
