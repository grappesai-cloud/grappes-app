import type { Niche } from "./types";

export type DimensionVisibility = {
  voice_impact: boolean;
  visual_pull: boolean;
  emotional_hit: boolean;
  cognitive_grip: boolean;
  memorability: boolean;
};

export type BrainSlot =
  | "occipital"
  | "temporal"
  | "limbic"
  | "prefrontal"
  | "hippocampus"
  | "motor"
  | "cerebellum";

export type NicheProfile = {
  dims: DimensionVisibility;
  /** Which signal each anatomical zone listens to for this niche. */
  brainEmphasis: BrainSlot[];
  /** Hint shown in UI explaining why some cards are hidden. */
  rationale?: string;
};

const ALL_DIMS: DimensionVisibility = {
  voice_impact: true,
  visual_pull: true,
  emotional_hit: true,
  cognitive_grip: true,
  memorability: true,
};

const NO_VOICE: DimensionVisibility = { ...ALL_DIMS, voice_impact: false };
const NO_GRIP: DimensionVisibility = { ...ALL_DIMS, cognitive_grip: false };

export const NICHE_PROFILE: Record<Niche, NicheProfile> = {
  comedy_skit: {
    dims: ALL_DIMS,
    brainEmphasis: ["temporal", "limbic", "prefrontal", "occipital", "hippocampus"],
  },
  talking_head: {
    dims: ALL_DIMS,
    brainEmphasis: ["temporal", "prefrontal", "limbic", "occipital", "hippocampus"],
  },
  educational: {
    dims: ALL_DIMS,
    brainEmphasis: ["temporal", "prefrontal", "occipital", "limbic", "hippocampus"],
  },
  vlog_lifestyle: {
    dims: ALL_DIMS,
    brainEmphasis: ["temporal", "occipital", "limbic", "prefrontal", "hippocampus"],
  },
  food_review: {
    dims: ALL_DIMS,
    brainEmphasis: ["occipital", "temporal", "limbic", "hippocampus", "prefrontal"],
  },
  food_recipe: {
    dims: NO_VOICE,
    brainEmphasis: ["occipital", "prefrontal", "hippocampus", "motor", "cerebellum"],
    rationale:
      "Recipe reels are visually-led — voice doesn't carry retention here.",
  },
  product_demo: {
    dims: ALL_DIMS,
    brainEmphasis: ["occipital", "prefrontal", "temporal", "limbic", "hippocampus"],
  },
  tech_demo: {
    dims: ALL_DIMS,
    brainEmphasis: ["occipital", "prefrontal", "temporal", "limbic", "hippocampus"],
  },
  fitness_motivation: {
    dims: NO_GRIP,
    brainEmphasis: ["occipital", "motor", "limbic", "temporal", "hippocampus"],
    rationale:
      "Motivation reels work on emotional + motor activation, not comprehension.",
  },
  fitness_tutorial: {
    dims: ALL_DIMS,
    brainEmphasis: ["occipital", "motor", "prefrontal", "temporal", "hippocampus"],
  },
  transformation: {
    dims: NO_GRIP,
    brainEmphasis: ["occipital", "limbic", "hippocampus", "temporal", "prefrontal"],
    rationale: "Transformation reels rely on visual reveal + emotion, not language.",
  },
  travel: {
    dims: NO_GRIP,
    brainEmphasis: ["occipital", "limbic", "hippocampus", "temporal", "prefrontal"],
  },
  fashion_outfit: {
    dims: { ...ALL_DIMS, voice_impact: false, cognitive_grip: false },
    brainEmphasis: ["occipital", "limbic", "hippocampus", "motor", "cerebellum"],
    rationale: "Outfit reels are pure visual + emotion.",
  },
  thirst_trap: {
    dims: { ...ALL_DIMS, voice_impact: false, cognitive_grip: false },
    brainEmphasis: ["occipital", "limbic", "motor", "hippocampus", "cerebellum"],
    rationale: "Thirst traps don't carry verbal or comprehension load.",
  },
  dance_choreo: {
    dims: { ...ALL_DIMS, voice_impact: false, cognitive_grip: false },
    brainEmphasis: ["motor", "occipital", "cerebellum", "limbic", "hippocampus"],
    rationale: "Dance is motor + visual rhythm — voice/grip don't apply.",
  },
  dj_set: {
    dims: { ...ALL_DIMS, voice_impact: false, cognitive_grip: false },
    brainEmphasis: ["temporal", "motor", "limbic", "occipital", "cerebellum"],
    rationale:
      "DJ reels are music-led — auditory + emotional/motor. Speech metrics N/A.",
  },
  music_performance: {
    dims: { ...ALL_DIMS, cognitive_grip: false },
    brainEmphasis: ["temporal", "limbic", "motor", "occipital", "hippocampus"],
  },
  asmr: {
    dims: { ...ALL_DIMS, voice_impact: true, cognitive_grip: false, visual_pull: false },
    brainEmphasis: ["temporal", "limbic", "hippocampus", "occipital", "cerebellum"],
    rationale: "ASMR is purely auditory — visuals are static by design.",
  },
  other: {
    dims: ALL_DIMS,
    brainEmphasis: ["temporal", "occipital", "limbic", "prefrontal", "hippocampus"],
  },
};

export function profileFor(niche?: Niche): NicheProfile {
  if (!niche) return NICHE_PROFILE.other;
  return NICHE_PROFILE[niche] ?? NICHE_PROFILE.other;
}

/**
 * Per-clip min/max normalization for a signal so the brain doesn't go cold
 * on quiet content (ASMR at -50 dB) or saturated on loud content (DJ set).
 * Output is in 0..1 range.
 */
export function normalizeSamples(
  samples: { sec: number; value: number }[],
  fallbackMin: number,
  fallbackMax: number,
): (atTime: number) => number {
  if (!samples || samples.length === 0) {
    return () => 0;
  }
  const values = samples.map((s) => s.value);
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  // Guard against degenerate signals (silence-only or static).
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-3) {
    lo = fallbackMin;
    hi = fallbackMax;
  }
  const span = Math.max(hi - lo, 1e-3);

  return (t: number) => {
    if (t <= samples[0].sec) return clamp01((samples[0].value - lo) / span);
    if (t >= samples[samples.length - 1].sec)
      return clamp01(
        (samples[samples.length - 1].value - lo) / span,
      );
    for (let i = 1; i < samples.length; i++) {
      if (samples[i].sec >= t) {
        const a = samples[i - 1];
        const b = samples[i];
        const f = (t - a.sec) / Math.max(b.sec - a.sec, 0.0001);
        const v = a.value + (b.value - a.value) * f;
        return clamp01((v - lo) / span);
      }
    }
    return 0;
  };
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
