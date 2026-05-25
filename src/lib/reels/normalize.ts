import type { AnalysisResult, Dimension, SequenceDimension } from "./types";

/**
 * Guarantee a complete `dimensions` object on an analysis result. The model's
 * analyze_reel tool output isn't strictly enforced, and the self-critique pass
 * (or a max_tokens truncation) can drop sub-dimensions — which crashed the
 * analysis page's SSR (TypeError reading `.score` of undefined). Recover any
 * missing dimension from the `fallback` (first pass) when possible, else
 * synthesize one from the overall score, so every dimension always carries a
 * numeric `.score`. Mutates `result` in place.
 */
export function ensureCompleteDimensions(
  result: AnalysisResult,
  fallback: AnalysisResult,
): void {
  const base = result.overall?.score ?? fallback.overall?.score ?? 0;
  const cur = (result.dimensions ?? {}) as Partial<AnalysisResult["dimensions"]>;
  const fb = (fallback.dimensions ?? {}) as Partial<AnalysisResult["dimensions"]>;
  const okScore = (d: unknown): d is { score: number } =>
    !!d && typeof (d as { score?: unknown }).score === "number";

  const fullDim = (d: unknown, f: unknown): Dimension => {
    const src = okScore(d) ? (d as Dimension) : okScore(f) ? (f as Dimension) : null;
    return src
      ? {
          score: src.score,
          timeline: Array.isArray(src.timeline) ? src.timeline : [],
          moments: Array.isArray(src.moments) ? src.moments : [],
          summary: typeof src.summary === "string" ? src.summary : "",
        }
      : { score: base, timeline: [], moments: [], summary: "derived from overall score" };
  };
  const seqDim = (d: unknown, f: unknown): SequenceDimension => {
    const src = okScore(d) ? (d as SequenceDimension) : okScore(f) ? (f as SequenceDimension) : null;
    return src
      ? { score: src.score, summary: typeof src.summary === "string" ? src.summary : "" }
      : { score: base, summary: "derived from overall score" };
  };

  result.dimensions = {
    voice_impact: fullDim(cur.voice_impact, fb.voice_impact),
    visual_pull: fullDim(cur.visual_pull, fb.visual_pull),
    emotional_hit: fullDim(cur.emotional_hit, fb.emotional_hit),
    cognitive_grip: seqDim(cur.cognitive_grip, fb.cognitive_grip),
    memorability: seqDim(cur.memorability, fb.memorability),
  };
}
