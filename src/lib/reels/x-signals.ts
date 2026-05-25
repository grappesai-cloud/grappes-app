import type {
  AnalysisResult,
  DropPoint,
  Moment,
  RetentionPoint,
  SignalSample,
  TextOverlay,
  TimelinePoint,
  XRankingSignals,
  XSignal,
  XSignalId,
} from "./types";

export type { XRankingSignals, XSignal, XSignalId } from "./types";

const WEIGHTS: Record<XSignalId, number> = {
  hook_velocity: 0.18,
  early_negative_feedback: 0.15,
  retention_auc: 0.14,
  engagement_velocity: 0.12,
  memorability: 0.1,
  niche_fit: 0.09,
  av_sync: 0.08,
  pacing_consistency: 0.06,
  overlay_legibility: 0.05,
  cta_weight: 0.03,
};

const clamp01 = (n: number): number => (n < 0 ? 0 : n > 1 ? 1 : n);
const clamp100 = (n: number): number => Math.round(clamp01(n / 100) * 100);
const round = (n: number, p = 1): number => {
  const m = 10 ** p;
  return Math.round(n * m) / m;
};

function normalizeInClipRange(
  samples: SignalSample[],
  value: number,
): number {
  if (!samples?.length) return 0;
  let lo = Infinity;
  let hi = -Infinity;
  for (const s of samples) {
    if (s.value < lo) lo = s.value;
    if (s.value > hi) hi = s.value;
  }
  if (hi - lo < 1e-6) return 0.5;
  return clamp01((value - lo) / (hi - lo));
}

function coefficientOfVariation(samples: SignalSample[]): number {
  if (samples.length < 2) return 0;
  const mean = samples.reduce((a, s) => a + s.value, 0) / samples.length;
  if (Math.abs(mean) < 1e-6) return 0;
  const variance =
    samples.reduce((a, s) => a + (s.value - mean) ** 2, 0) / samples.length;
  return Math.sqrt(variance) / Math.abs(mean);
}

function retentionAuc(curve: RetentionPoint[] | undefined): number {
  if (!curve?.length) return 0;
  let area = 0;
  for (let i = 1; i < curve.length; i++) {
    const a = curve[i - 1];
    const b = curve[i];
    area += ((a.retention_pct + b.retention_pct) / 2) * (b.sec - a.sec);
  }
  const total = (curve[curve.length - 1].sec - curve[0].sec) * 100;
  if (total < 1e-6) return 0;
  return clamp01(area / total);
}

function severityToFloat(s: DropPoint["severity"]): number {
  if (s === "severe") return 1;
  if (s === "moderate") return 0.6;
  return 0.3;
}

function peakInWindow(
  timeline: TimelinePoint[] | undefined,
  moments: Moment[] | undefined,
  from: number,
  to: number,
): number {
  let best = 0;
  if (timeline) {
    for (const p of timeline) {
      if (p.sec >= from && p.sec <= to && p.value > best) best = p.value;
    }
  }
  if (moments) {
    for (const m of moments) {
      if (m.type === "peak" && m.sec >= from && m.sec <= to && m.value > best) {
        best = m.value;
      }
    }
  }
  return best;
}

function overlayLegibility(overlays: TextOverlay[] | undefined): {
  score: number;
  count: number;
} {
  if (!overlays?.length) return { score: 50, count: 0 };
  const total = overlays.reduce((a, o) => a + (o.legibility ?? 0), 0);
  return { score: clamp100(total / overlays.length), count: overlays.length };
}

function hookVelocity(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const signals = result.signals;
  const hookScore = result.hook?.score ?? 0;
  if (!signals) {
    return {
      score: hookScore,
      detail: `hook model score only · ${hookScore}/100`,
      source: "model",
    };
  }
  const motionPeak = peakInWindow(
    signals.motion.map((s) => ({ sec: s.sec, value: s.value })),
    undefined,
    0,
    3,
  );
  const loudPeak = peakInWindow(
    signals.loudness.map((s) => ({ sec: s.sec, value: s.value })),
    undefined,
    0,
    3,
  );
  const motionNorm = normalizeInClipRange(signals.motion, motionPeak);
  const loudNorm = normalizeInClipRange(signals.loudness, loudPeak);
  const grabsAt = result.hook?.grabs_attention_at_sec ?? 3;
  const grabsBonus = clamp01(1 - grabsAt / 3);
  const composite =
    (hookScore / 100) * 0.5 + motionNorm * 0.2 + loudNorm * 0.15 + grabsBonus * 0.15;
  return {
    score: clamp100(composite * 100),
    detail: `motion ${round(motionNorm * 100)}, loud ${round(loudNorm * 100)}, grabs@${round(grabsAt, 1)}s, hook ${hookScore}`,
    source: "measured",
  };
}

function earlyNegativeFeedback(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const drops = result.retention_estimate?.drop_points ?? [];
  const deadZones = result.pacing?.dead_zones ?? [];
  let penalty = 0;
  const earlyDrops = drops.filter((d) => d.sec <= 5);
  for (const d of earlyDrops) penalty += severityToFloat(d.severity) * 25;
  const earlyDead = deadZones.filter((dz) => dz.start_sec <= 5);
  for (const dz of earlyDead) {
    const overlap = Math.min(5, dz.end_sec) - Math.max(0, dz.start_sec);
    if (overlap > 0) penalty += overlap * 6;
  }
  const score = clamp100(100 - penalty);
  return {
    score,
    detail:
      earlyDrops.length || earlyDead.length
        ? `${earlyDrops.length} early drop(s), ${earlyDead.length} dead zone(s) in first 5s`
        : "no early-drop signals in first 5s",
    source: drops.length || deadZones.length ? "measured" : "estimated",
  };
}

function pacingConsistency(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const cd = result.signals?.cut_density;
  if (!cd?.length) {
    const cps = result.pacing?.cuts_per_sec ?? 0;
    const ideal = cps >= 0.3 && cps <= 1.2;
    return {
      score: ideal ? 70 : 45,
      detail: `cuts/s ${round(cps, 2)} (no per-second density)`,
      source: "estimated",
    };
  }
  const cv = coefficientOfVariation(cd);
  const score = clamp100((1 - clamp01(cv / 1.5)) * 100);
  return {
    score,
    detail: `cut-density CV ${round(cv, 2)} (lower = steadier rhythm)`,
    source: "measured",
  };
}

function avSync(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const sync = result.audio?.sync_with_visuals ?? 0;
  const beat = result.audio?.cuts_on_beat_pct;
  if (beat != null) {
    const combined = (sync / 100) * 0.6 + (beat / 100) * 0.4;
    return {
      score: clamp100(combined * 100),
      detail: `sync ${sync}, on-beat ${beat}%`,
      source: "measured",
    };
  }
  return {
    score: clamp100(sync),
    detail: `sync ${sync}`,
    source: "model",
  };
}

function nicheFit(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const conf = result.niche?.confidence ?? 0;
  const dims = result.dimensions;
  // Older/partial analyses can have a `dimensions` object that's missing some
  // sub-dimensions, so guard every access — a single missing field here used
  // to throw during SSR and blank the whole analysis page.
  const dimScores = dims
    ? [
        dims.voice_impact,
        dims.visual_pull,
        dims.emotional_hit,
        dims.cognitive_grip,
        dims.memorability,
      ]
        .map((d) => d?.score)
        .filter((s): s is number => typeof s === "number")
    : [];
  const dimAvg = dimScores.length
    ? dimScores.reduce((a, b) => a + b, 0) / dimScores.length
    : (result.overall?.score ?? 0);
  const combined = (conf / 100) * 0.5 + (dimAvg / 100) * 0.5;
  return {
    score: clamp100(combined * 100),
    detail: `${result.niche?.niche ?? "unknown"} · conf ${conf}, dim avg ${round(dimAvg)}`,
    source: "model",
  };
}

function ctaWeight(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const cta = result.cta;
  if (!cta || !cta.present) {
    return {
      score: 30,
      detail: "no CTA detected",
      source: "model",
    };
  }
  const dur = result.meta?.duration_sec || 1;
  const timing = cta.timing_sec ?? dur;
  const tailBonus = clamp01(timing / dur);
  const score = clamp100(cta.strength * 0.7 + tailBonus * 30);
  return {
    score,
    detail: `${cta.type ?? "cta"} @ ${round(timing, 1)}s, strength ${cta.strength}`,
    source: "model",
  };
}

function memorability(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const score = result.dimensions?.memorability?.score ?? result.overall?.score ?? 0;
  return {
    score: clamp100(score),
    detail: result.dimensions?.memorability?.summary ?? "from overall score",
    source: "model",
  };
}

function engagementVelocity(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const dur = result.meta?.duration_sec || 1;
  const cutoff = dur * 0.3;
  const eng = result.engagement;
  const peak = peakInWindow(eng?.timeline, eng?.moments, 0, cutoff);
  if (peak > 0) {
    return {
      score: clamp100(peak),
      detail: `peak engagement ${round(peak)} in first 30% (≤${round(cutoff, 1)}s)`,
      source: "model",
    };
  }
  const retentionAt = result.retention_estimate?.curve?.find(
    (p) => p.sec >= cutoff,
  )?.retention_pct;
  return {
    score: clamp100(retentionAt ?? (result.overall?.score ?? 0) * 0.8),
    detail: `retention proxy @ ${round(cutoff, 1)}s = ${round(retentionAt ?? 0)}`,
    source: "estimated",
  };
}

function overlayLegibilitySignal(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const { score, count } = overlayLegibility(result.text_overlays);
  return {
    score,
    detail: count
      ? `${count} overlay(s), avg legibility ${score}`
      : "no text overlays — neutral baseline",
    source: count ? "measured" : "estimated",
  };
}

function retentionAucSignal(result: AnalysisResult): {
  score: number;
  detail: string;
  source: XSignal["source"];
} {
  const auc = retentionAuc(result.retention_estimate?.curve);
  return {
    score: clamp100(auc * 100),
    detail: `area under retention curve = ${round(auc * 100)}/100`,
    source: "model",
  };
}

const LABELS: Record<XSignalId, string> = {
  hook_velocity: "Hook velocity",
  early_negative_feedback: "Early negative feedback",
  pacing_consistency: "Pacing consistency",
  av_sync: "A/V sync",
  niche_fit: "Niche fit",
  cta_weight: "CTA weight",
  memorability: "Memorability",
  engagement_velocity: "Engagement velocity",
  overlay_legibility: "Overlay legibility",
  retention_auc: "Retention AUC",
};

export function computeXRankingSignals(
  result: AnalysisResult,
): XRankingSignals {
  const computed: Record<
    XSignalId,
    { score: number; detail: string; source: XSignal["source"] }
  > = {
    hook_velocity: hookVelocity(result),
    early_negative_feedback: earlyNegativeFeedback(result),
    pacing_consistency: pacingConsistency(result),
    av_sync: avSync(result),
    niche_fit: nicheFit(result),
    cta_weight: ctaWeight(result),
    memorability: memorability(result),
    engagement_velocity: engagementVelocity(result),
    overlay_legibility: overlayLegibilitySignal(result),
    retention_auc: retentionAucSignal(result),
  };

  const signals: XSignal[] = (Object.keys(WEIGHTS) as XSignalId[]).map((id) => {
    const c = computed[id];
    const w = WEIGHTS[id];
    return {
      id,
      label: LABELS[id],
      score: c.score,
      weight: w,
      contribution: round((c.score * w) / 100, 3),
      detail: c.detail,
      source: c.source,
    };
  });

  const heavy = Math.round(
    signals.reduce((a, s) => a + s.score * s.weight, 0),
  );
  const band: XRankingSignals["band"] =
    heavy >= 72 ? "boosted" : heavy >= 50 ? "neutral" : "throttled";

  const sortedDown = [...signals].sort((a, b) => a.score - b.score);
  const worst = sortedDown.slice(0, 2);
  const sortedUp = [...signals].sort((a, b) => b.score - a.score);
  const best = sortedUp[0];

  const rationale =
    band === "boosted"
      ? `Heavy-ranker would BOOST this reel. ${best.label} (${best.score}) carries it; weakest is ${worst[0].label} (${worst[0].score}).`
      : band === "neutral"
        ? `Heavy-ranker treats this NEUTRAL. ${best.label} is strong (${best.score}); fix ${worst[0].label} (${worst[0].score}) and ${worst[1].label} (${worst[1].score}) to cross the boost line.`
        : `Heavy-ranker would THROTTLE this reel. ${worst[0].label} (${worst[0].score}) and ${worst[1].label} (${worst[1].score}) are the bleeders.`;

  return {
    heavy_ranker_score: heavy,
    band,
    signals,
    rationale,
  };
}
