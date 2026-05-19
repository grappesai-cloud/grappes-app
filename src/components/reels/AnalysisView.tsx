import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { Analysis } from "../../lib/reels/db";
import type { AnalysisResult, ProcessingProgress } from "../../lib/reels/types";
import CognitiveCard from "./_components/CognitiveCard";
import EngagementTimeline from "./_components/EngagementTimeline";
import HookMockups from "./_components/HookMockups";
import SourceTag from "./_components/SourceTag";
import XSignalsCard from "./_components/XSignalsCard";
import { computeXRankingSignals } from "../../lib/reels/x-signals";
import IntakeForm from "./IntakeForm";
import { normalizeSamples, profileFor } from "../../lib/reels/niche-profile";
import VideoPlayer, {
  type VideoPlayerHandle,
} from "./_components/VideoPlayer";
import AnimatedNumber from "./_components/AnimatedNumber";
import Pill from "./_components/Pill";
import Reveal from "./_components/Reveal";
import BrainHeatmap from "./_components/BrainHeatmap";

type Props = { id: string; initial: Analysis };

export default function AnalysisView({ id, initial }: Props) {
  const [row, setRow] = useState<Analysis>(initial);

  useEffect(() => {
    if (row.status === "done" || row.status === "failed") return;
    let cancel = false;
    const tick = async () => {
      try {
        const r = await fetch(`/api/reels/analysis/${id}`, { cache: "no-store" });
        if (!r.ok) return;
        const next = (await r.json()) as Analysis;
        if (!cancel) setRow(next);
      } catch {}
    };
    const iv = setInterval(tick, 1500);
    return () => {
      cancel = true;
      clearInterval(iv);
    };
  }, [id, row.status]);

  if (row.status === "failed") {
    return (
      <div className="rounded-xl border border-rose-900 bg-rose-950/40 p-8">
        <div className="font-mono text-xs uppercase tracking-widest text-rose-400">
          Analysis failed
        </div>
        <div className="mt-2 text-zinc-200">{row.fileName}</div>
        <pre className="mt-4 overflow-x-auto whitespace-pre-wrap rounded bg-zinc-950 p-3 font-mono text-xs text-rose-300">
          {row.error ?? "unknown error"}
        </pre>
      </div>
    );
  }

  const progress = (row.progress ?? null) as ProcessingProgress | null;
  if (
    progress?.intake &&
    !progress.intake_answers &&
    row.status !== "done"
  ) {
    return (
      <IntakeStep
        id={id}
        intake={progress.intake}
        onSubmitted={() => setRow({ ...row })}
      />
    );
  }

  if (row.status !== "done") {
    return <ProcessingState row={row} />;
  }

  const result = row.result as AnalysisResult;
  return <Dashboard row={row} result={result} />;
}

function IntakeStep({
  id,
  intake,
  onSubmitted,
}: {
  id: string;
  intake: NonNullable<ProcessingProgress["intake"]>;
  onSubmitted: () => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (answers: Record<string, string>) => {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/reels/intake/${id}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ answers }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.error ?? `intake ${res.status}`);
      }
      onSubmitted();
    } catch (e) {
      setError(e instanceof Error ? e.message : "intake submit failed");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl">
      <IntakeForm context={intake} onSubmit={submit} submitting={submitting} />
      {error && (
        <p className="mt-4 text-center font-mono text-xs text-rose-400">
          {error}
        </p>
      )}
    </div>
  );
}

function ProcessingState({ row }: { row: Analysis }) {
  const progress = (row.progress ?? {
    step: "queued",
    pct: 0,
    message: "Queued",
  }) as ProcessingProgress;
  const pct = Math.max(0, Math.min(100, progress.pct ?? 0));
  const stepLabel = (progress.step ?? "queued").replace(/_/g, " ");
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="mx-auto flex min-h-[60vh] max-w-2xl flex-col"
    >
      <section
        className="relative overflow-hidden rounded-3xl border border-white/10 p-10 lg:p-14"
        style={{
          background:
            "linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%), rgba(18,18,22,0.92)",
          backdropFilter: "blur(24px) saturate(1.3)",
          boxShadow:
            "0 1px 0 rgba(255,255,255,0.05) inset, 0 24px 60px -32px rgba(0,0,0,0.6)",
        }}
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full blur-3xl"
          style={{ background: "rgba(167,139,250,0.18)" }}
        />
        <div
          className="pointer-events-none absolute -left-20 -bottom-24 h-56 w-56 rounded-full blur-3xl"
          style={{ background: "rgba(6,191,221,0.10)" }}
        />

        <div className="relative">
          <div className="mb-8 inline-flex items-center gap-2 rounded-full border border-violet-500/30 bg-violet-500/10 px-3 py-1.5 font-mono text-[10.5px] font-bold uppercase tracking-[0.18em] text-violet-300">
            <motion.span
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 1.6, repeat: Infinity }}
              className="h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_8px_currentColor]"
            />
            Analysis in progress
          </div>

          <div className="flex items-end justify-between gap-6">
            <div>
              <div className="font-mono text-[10.5px] uppercase tracking-[0.22em] text-white/45">
                {stepLabel}
              </div>
              <p className="mt-2 max-w-md text-[15px] leading-snug text-white/85">
                {progress.message}
              </p>
            </div>
            <div className="text-right">
              <div className="bg-gradient-to-br from-white to-white/60 bg-clip-text font-serif text-6xl font-light tabular-nums leading-none text-transparent">
                {pct}
              </div>
              <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.22em] text-white/40">
                percent
              </div>
            </div>
          </div>

          <div className="mt-8 h-[5px] w-full overflow-hidden rounded-full bg-white/[0.06]">
            <motion.div
              animate={{ width: `${pct}%` }}
              transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
              className="h-full rounded-full"
              style={{
                background:
                  "linear-gradient(90deg, #a78bfa 0%, #f97316 60%, #06bfdd 100%)",
                boxShadow: "0 0 12px rgba(167,139,250,0.45)",
              }}
            />
          </div>

          <div className="mt-10 flex items-center justify-between gap-4 border-t border-white/[0.07] pt-5">
            <span className="truncate font-mono text-[10.5px] uppercase tracking-[0.18em] text-white/40">
              {row.fileName}
            </span>
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-[0.2em] text-white/35">
              Live · auto-refreshing
            </span>
          </div>
        </div>
      </section>

      <p className="mt-6 text-center text-[12.5px] leading-relaxed text-white/45">
        We're scoring every second across attention, emotion, memory, decision and comprehension.<br />
        Feel free to leave this tab — we'll keep going in the background.
      </p>
    </motion.div>
  );
}

export function Dashboard({
  row,
  result,
}: {
  row: Analysis;
  result: AnalysisResult;
}) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [tab, setTab] = useState<"summary" | "in_depth">("in_depth");
  const [videoTime, setVideoTime] = useState(0);

  const seek = (sec: number, reason?: string) => {
    playerRef.current?.seek(sec);
    if (reason) {
      playerRef.current?.pause();
      playerRef.current?.showOverlay(reason, 3500);
    }
    window.scrollTo({
      top: 0,
      behavior: "smooth",
    });
  };

  const seekToMoment = (sec: number, reason: string) => seek(sec, reason);

  useEffect(() => {
    const isTyping = () => {
      const a = document.activeElement;
      return (
        a instanceof HTMLInputElement ||
        a instanceof HTMLTextAreaElement ||
        a instanceof HTMLSelectElement
      );
    };
    const handler = (e: KeyboardEvent) => {
      if (isTyping()) return;
      if (e.key === " ") {
        e.preventDefault();
        playerRef.current?.togglePlay();
      } else if (e.key === "ArrowLeft") {
        e.preventDefault();
        playerRef.current?.seek(Math.max(0, videoTime - 2));
      } else if (e.key === "ArrowRight") {
        e.preventDefault();
        playerRef.current?.seek(
          Math.min(result.meta.duration_sec, videoTime + 2),
        );
      } else if (e.key === "j") {
        playerRef.current?.seek(Math.max(0, videoTime - 10));
      } else if (e.key === "l") {
        playerRef.current?.seek(
          Math.min(result.meta.duration_sec, videoTime + 10),
        );
      } else if (e.key === "k") {
        playerRef.current?.togglePlay();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [videoTime, result.meta.duration_sec]);

  const dims = result.dimensions;
  const hasDimensions = !!dims;

  const interp = (
    timeline: { sec: number; value: number }[] | undefined,
    t: number,
    fallback: number,
  ): number => {
    if (!timeline || timeline.length === 0) return fallback;
    if (t <= timeline[0].sec) return timeline[0].value;
    if (t >= timeline[timeline.length - 1].sec)
      return timeline[timeline.length - 1].value;
    for (let i = 1; i < timeline.length; i++) {
      if (timeline[i].sec >= t) {
        const a = timeline[i - 1];
        const b = timeline[i];
        const f = (t - a.sec) / Math.max(b.sec - a.sec, 0.0001);
        return a.value + (b.value - a.value) * f;
      }
    }
    return timeline[timeline.length - 1].value;
  };

  const signals = result.signals;
  const nicheProfile = profileFor(result.niche?.niche);

  // Per-clip min/max normalization so the brain reflects WHAT'S HAPPENING IN
  // THIS REEL, not absolute thresholds. ASMR at -50 dB will still light auditory
  // for its loudest moments; a DJ set at -8 dB won't sit permanently red.
  const motionNorm = signals
    ? normalizeSamples(signals.motion, 0, 60)
    : () => 0;
  const loudNorm = signals
    ? normalizeSamples(signals.loudness, -40, -10)
    : () => 0;
  const cutNorm = signals
    ? normalizeSamples(signals.cut_density, 0, 5)
    : () => 0;
  const motionAt = motionNorm(videoTime);
  const loudAt = loudNorm(videoTime);
  const cutDensityAt = cutNorm(videoTime);

  // Loudness/motion deltas over the last ~1s — proxy for "salience" / surprise,
  // which is what actually fires limbic structures in real life.
  const deltaWindow = 1.2;
  const motionDelta = signals
    ? Math.abs(
        interp(signals.motion, videoTime, 0) -
          interp(signals.motion, Math.max(0, videoTime - deltaWindow), 0),
      ) / 30
    : 0;
  const loudDelta = signals
    ? Math.abs(
        interp(signals.loudness, videoTime, -40) -
          interp(signals.loudness, Math.max(0, videoTime - deltaWindow), -40),
      ) / 8
    : 0;
  const limbicAt = Math.max(0, Math.min(1, motionDelta * 0.6 + loudDelta * 0.6));

  // Hippocampal pulse: discrete event each time the player crosses a scene cut.
  const scenePulse = (() => {
    if (!signals || videoTime <= 0) return 0;
    let best = 0;
    for (const c of signals.scene_cuts) {
      const dt = videoTime - c.time_sec;
      if (dt >= 0 && dt < 1.5) {
        const intensity = 1 - dt / 1.5;
        if (intensity > best) best = intensity;
      }
    }
    return best;
  })();

  const liveEngagement = interp(
    result.engagement?.timeline,
    videoTime,
    result.overall.score,
  );

  // brain.obj bbox after normalization: x ∈ ±0.77, y ∈ ±0.67, z ∈ ±0.63.
  // Longest axis = X = rostro-caudal (front-back). Y = vertical (up-down).
  // Z = lateral (left-right). Default assumes +X = posterior (back),
  // -X = anterior (frontal). If flipped on the actual mesh, toggle "flip X"
  // in the brain's debug panel and the layout mirrors instantly.
  const allowedSlots = new Set(nicheProfile.brainEmphasis);
  // Motor / cerebellum derived signals — we don't have body-part-specific
  // tracking, so motor = peak motion, cerebellum = cut-density rhythm.
  const motorAt = motionAt;
  const cerebellumAt = cutDensityAt;
  const brainRegions = signals
    ? [
        {
          id: "occipital",
          label: "Visual cortex",
          source: `motion ${(motionAt * 100).toFixed(0)}`,
          // back of head, near midline, slightly low
          center: [0.55, -0.05, 0] as [number, number, number],
          radius: 0.28,
          activity: motionAt,
        },
        {
          id: "temporal_L",
          label: "Auditory (L)",
          source: `loudness ${(loudAt * 100).toFixed(0)}`,
          // mid x, slightly low y, far -z (left side)
          center: [0.0, -0.15, -0.5] as [number, number, number],
          radius: 0.24,
          activity: loudAt,
        },
        {
          id: "temporal_R",
          label: "Auditory (R)",
          source: `loudness ${(loudAt * 100).toFixed(0)}`,
          center: [0.0, -0.15, 0.5] as [number, number, number],
          radius: 0.24,
          activity: loudAt,
        },
        {
          id: "limbic",
          label: "Limbic / salience",
          source: `Δmotion+Δaudio ${(limbicAt * 100).toFixed(0)}`,
          // central-deep, slightly anterior of mid
          center: [-0.1, -0.15, 0] as [number, number, number],
          radius: 0.26,
          activity: limbicAt,
        },
        {
          id: "prefrontal",
          label: "Prefrontal / cuts",
          source: `cut density ${(cutDensityAt * 100).toFixed(0)}`,
          // front of head, high
          center: [-0.55, 0.3, 0] as [number, number, number],
          radius: 0.3,
          activity: cutDensityAt,
        },
        {
          id: "hippocampus_L",
          label: "Hippocampus (L)",
          source: `scene cut pulse`,
          // mid-low, lateral
          center: [0.15, -0.35, -0.35] as [number, number, number],
          radius: 0.18,
          activity: scenePulse,
        },
        {
          id: "hippocampus_R",
          label: "Hippocampus (R)",
          source: `scene cut pulse`,
          center: [0.15, -0.35, 0.35] as [number, number, number],
          radius: 0.18,
          activity: scenePulse,
        },
        {
          id: "motor",
          label: "Motor cortex",
          source: `peak motion ${(motorAt * 100).toFixed(0)}`,
          // top-front, paramedian — precentral gyrus area
          center: [-0.2, 0.4, 0] as [number, number, number],
          radius: 0.24,
          activity: motorAt,
        },
        {
          id: "cerebellum",
          label: "Cerebellum",
          source: `cut rhythm ${(cerebellumAt * 100).toFixed(0)}`,
          // back-bottom, below occipital
          center: [0.5, -0.5, 0] as [number, number, number],
          radius: 0.22,
          activity: cerebellumAt,
        },
      ]
        // Drop slots not relevant to this niche so the brain only fires
        // for what actually matters here.
        .filter((r) => {
          const slot = r.id.replace(/_[LR]$/, "") as
            | "occipital"
            | "temporal"
            | "limbic"
            | "prefrontal"
            | "hippocampus"
            | "motor"
            | "cerebellum";
          return allowedSlots.has(slot);
        })
    : [
        {
          id: "overall",
          label: "Overall",
          source: "no signals available",
          center: [0, 0, 0] as [number, number, number],
          radius: 1.0,
          activity: result.overall.score / 100,
        },
      ];

  return (
    <div className="space-y-12">
      <motion.header
        initial={{ opacity: 0, y: -12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
        className="flex flex-wrap items-end justify-between gap-6"
      >
        <div>
          <div className="mb-3 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Reel Lab · Analysis
            </span>
            {result.niche && (
              <Pill>
                {result.niche.niche.replace(/_/g, " ")} ·{" "}
                {result.niche.confidence}
              </Pill>
            )}
          </div>
          <h1 className="font-serif text-5xl font-normal tracking-tight text-zinc-50 sm:text-6xl">
            {row.fileName}
          </h1>
          <p className="mt-3 font-mono text-xs uppercase tracking-[0.2em] text-zinc-500">
            {result.meta.duration_sec.toFixed(1)}s · {result.meta.aspect_ratio} ·{" "}
            {result.meta.fps}fps · {result.meta.file_size_mb}MB
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            <SourceTag source="measured" />
            <SourceTag source="model" />
            <SourceTag source="estimated" />
          </div>
        </div>
        <div className="flex flex-col items-end gap-3">
          <ScoreBadge score={result.overall.score} />
          <div className="flex items-center gap-2" data-print-hide="true">
            <button
              type="button"
              onClick={() => window.print()}
              className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-zinc-300 hover:bg-zinc-900"
            >
              ⤓ export · pdf
            </button>
            <span
              className="hidden rounded-full border border-zinc-900 bg-zinc-950/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-500 sm:inline-flex"
              title="Space / K = play/pause · ←/→ = ±2s · J/L = ±10s"
            >
              ⌨ space · ← → · j l
            </span>
          </div>
        </div>
      </motion.header>

      <motion.section
        initial={{ opacity: 0, y: 28 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, delay: 0.15, ease: [0.22, 1, 0.36, 1] }}
        className="grid grid-cols-1 gap-5 lg:grid-cols-[1.4fr_1fr]"
      >
        <VideoPlayer
          ref={playerRef}
          videoUrl={row.blobUrl}
          duration={result.meta.duration_sec}
          engagement={
            result.engagement ?? {
              timeline: result.retention_estimate.curve.map((p) => ({
                sec: p.sec,
                value: p.retention_pct,
              })),
              moments: result.retention_estimate.drop_points.map((d) => ({
                sec: d.sec,
                value: 30,
                type: "dip" as const,
                reason: d.reason,
              })),
            }
          }
          signals={result.signals}
          deadZones={result.pacing?.dead_zones}
          recommendedThumbnailSec={result.recommended_thumbnail?.frame_sec}
          onTimeChange={(sec) => setVideoTime(sec)}
        />
        <BrainHeatmap
          regions={brainRegions}
          liveValue={liveEngagement}
          currentTime={videoTime}
          totalDuration={result.meta.duration_sec}
          className="h-full min-h-[420px]"
        />
      </motion.section>

      {result.overall.verdict && (
        <Reveal>
          <div className="relative overflow-hidden rounded-2xl border border-rose-900/50 bg-gradient-to-br from-rose-950/30 via-zinc-950 to-zinc-950 p-6 lg:p-8">
            <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-rose-700/20 blur-3xl" />
            <div className="relative">
              <div className="mb-3 flex items-center gap-2">
                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 shadow-[0_0_12px_rgba(244,63,94,0.8)]" />
                <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-rose-400">
                  Verdict
                </span>
              </div>
              <p className="max-w-4xl font-serif text-2xl leading-snug text-zinc-100 lg:text-3xl">
                {result.overall.verdict}
              </p>
            </div>
          </div>
        </Reveal>
      )}

      {(() => {
        const xs = result.x_signals ?? computeXRankingSignals(result);
        return (
          <Reveal>
            <XSignalsCard data={xs} />
          </Reveal>
        );
      })()}

      <div className="flex items-center justify-between gap-4 border-b border-zinc-900 pb-3">
        <div className="flex items-center rounded-full border border-zinc-800 bg-zinc-900/60 p-1">
          <TabButton
            label="Summary"
            active={tab === "summary"}
            onClick={() => setTab("summary")}
          />
          <TabButton
            label="In-Depth"
            active={tab === "in_depth"}
            onClick={() => setTab("in_depth")}
          />
        </div>
        <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
          Insights
        </span>
      </div>

      {hasDimensions && tab === "in_depth" && (
        <motion.div
          key="in_depth"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.4 }}
          className="space-y-5"
        >
          {nicheProfile.rationale && (
            <div className="rounded-xl border border-amber-900/40 bg-amber-950/20 px-4 py-2.5 font-mono text-[10px] uppercase tracking-widest text-amber-300">
              niche profile · {result.niche?.niche.replace(/_/g, " ")} ·{" "}
              <span className="normal-case tracking-normal text-amber-200">
                {nicheProfile.rationale}
              </span>
            </div>
          )}
          <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
            {nicheProfile.dims.voice_impact && (
              <CognitiveCard
                title="Voice Impact"
                via="Attention"
                description="Voice Impact measures how much the voiceover, sound design, and audio cues are doing the heavy lifting. A high score means viewers are processing what they hear — not just looking at the visuals — which is what keeps them past the first three seconds and lifts brand recall."
                data={dims.voice_impact}
                perSecond
                duration={result.meta.duration_sec}
                currentTime={videoTime}
                onMomentClick={(sec) => {
                  const m = dims.voice_impact.moments.find((mm) => mm.sec === sec);
                  seekToMoment(sec, m?.reason ?? "voice impact moment");
                }}
              />
            )}
            {nicheProfile.dims.visual_pull && (
              <CognitiveCard
                title="Visual Pull"
                via="Attention"
                description="Visual Pull measures how strongly the imagery commands the eye. A high score means the framing, motion, and on-screen treatment are pulling the viewer's gaze where the storyline wants it — the single biggest predictor of whether someone scrolls past or stops."
                data={dims.visual_pull}
                perSecond
                duration={result.meta.duration_sec}
                currentTime={videoTime}
                onMomentClick={(sec) => {
                  const m = dims.visual_pull.moments.find((mm) => mm.sec === sec);
                  seekToMoment(sec, m?.reason ?? "visual pull moment");
                }}
              />
            )}
          </div>
          {nicheProfile.dims.emotional_hit && (
            <CognitiveCard
              title="Emotional Hit"
              via="Emotion"
              description="Emotional Hit measures how strongly the content provokes a felt response — joy, surprise, urgency, empathy. A high score is what makes a creative shareable, memorable, and durable; emotional creative consistently out-performs neutral creative on every downstream KPI."
              data={dims.emotional_hit}
              perSecond
              duration={result.meta.duration_sec}
              currentTime={videoTime}
              onMomentClick={(sec) => {
                const m = dims.emotional_hit.moments.find((mm) => mm.sec === sec);
                seekToMoment(sec, m?.reason ?? "emotion moment");
              }}
            />
          )}
          {(nicheProfile.dims.cognitive_grip ||
            nicheProfile.dims.memorability) && (
            <div className="grid grid-cols-1 gap-5 md:grid-cols-2">
              {nicheProfile.dims.cognitive_grip && (
                <CognitiveCard
                  title="Cognitive Grip"
                  via="Comprehension"
                  description="Cognitive Grip measures how easily viewers can follow what you're communicating. A high score means the message lands without re-watching — which translates directly into intent shifts, click-through, and the willingness to act on the call-to-action."
                  data={dims.cognitive_grip}
                  perSecond={false}
                  duration={result.meta.duration_sec}
                  currentTime={videoTime}
                />
              )}
              {nicheProfile.dims.memorability && (
                <CognitiveCard
                  title="Memorability"
                  via="Memory"
                  description="Memorability measures how likely viewers are to remember the brand or message tomorrow. A high score predicts post-view recall and brand lift in tracking studies — the difference between an ad that ran and an ad that registered."
                  data={dims.memorability}
                  perSecond={false}
                  duration={result.meta.duration_sec}
                  currentTime={videoTime}
                />
              )}
            </div>
          )}
        </motion.div>
      )}

      {hasDimensions && (
        <Reveal>
          <EngagementTimeline
            data={result.engagement ?? { timeline: [], moments: [] }}
            duration={result.meta.duration_sec}
            currentTime={videoTime}
            onMomentClick={(sec) => {
              const m = result.engagement?.moments.find((mm) => mm.sec === sec);
              seekToMoment(sec, m?.reason ?? "engagement moment");
            }}
          />
        </Reveal>
      )}

      {result.hook?.variations && result.hook.variations.length > 0 && (
        <Reveal>
          <HookMockups
            videoUrl={row.blobUrl}
            variations={result.hook.variations}
            aspectRatio={result.meta.aspect_ratio}
            onSeek={(s) => seek(s)}
          />
        </Reveal>
      )}

{result.critique_meta && result.critique_meta.changes.length > 0 && (
        <Reveal>
          <CritiqueDiff meta={result.critique_meta} />
        </Reveal>
      )}

      <Reveal>
        <section className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-6">
          <header className="mb-4 flex items-baseline justify-between">
            <div className="flex items-center gap-2">
              <span className="text-zinc-500">ⓘ</span>
              <h3 className="text-base font-medium text-zinc-100">
                How we score these
              </h3>
            </div>
            <Pill>read methodology</Pill>
          </header>
          <p className="max-w-prose text-sm leading-relaxed text-zinc-400">
            We score every second of the video across five things the brain
            does — attention, emotion, memory, decision, and comprehension —
            then roll them up into the five cards above. The peaks and dips on
            each chart are the moments your viewers reacted noticeably more (or
            less) than the rest of the video.
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="relative overflow-hidden rounded-2xl border border-emerald-900/60 bg-gradient-to-br from-emerald-950/30 via-zinc-950 to-zinc-950 p-6 lg:p-8">
          <div className="absolute -left-12 -bottom-12 h-40 w-40 rounded-full bg-emerald-700/20 blur-3xl" />
          <div className="relative">
            <h3 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Top 3 actions for the next cut
            </h3>
            <ol className="space-y-4">
              {result.overall.top_3_actions.map((a, i) => {
                const meta = result.overall.top_3_actions_meta?.[i];
                return (
                  <li
                    key={i}
                    className="flex gap-4 border-l border-emerald-800/50 pl-4"
                  >
                    <span className="-ml-[18px] mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-emerald-800 bg-zinc-950 font-mono text-[11px] text-emerald-400">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <span className="text-base leading-relaxed text-zinc-200">
                          {a}
                        </span>
                        {meta && (
                          <span
                            className="shrink-0 rounded-full border border-emerald-700/70 bg-emerald-950/40 px-2.5 py-0.5 font-mono text-[11px] tabular-nums text-emerald-300"
                            title={meta.rationale}
                          >
                            +{meta.delta} score
                          </span>
                        )}
                      </div>
                      {meta && (
                        <p className="mt-1.5 text-xs leading-relaxed text-emerald-200/70">
                          {meta.rationale}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
            {result.overall.top_3_actions_meta &&
              result.overall.top_3_actions_meta.length > 0 && (
                <div className="mt-6 flex items-center gap-3 rounded-xl border border-emerald-800/50 bg-emerald-950/20 px-4 py-3 font-mono text-xs text-emerald-200">
                  <span className="text-emerald-500">Σ</span>
                  <span>
                    Aplicând toate cele 3:{" "}
                    <span className="tabular-nums text-emerald-100">
                      {result.overall.score}
                    </span>{" "}
                    →{" "}
                    <span className="tabular-nums text-emerald-100">
                      {Math.min(
                        100,
                        result.overall.score +
                          result.overall.top_3_actions_meta.reduce(
                            (a, b) => a + b.delta,
                            0,
                          ),
                      )}
                    </span>{" "}
                    <span className="text-emerald-400">
                      (+
                      {result.overall.top_3_actions_meta.reduce(
                        (a, b) => a + b.delta,
                        0,
                      )}
                      )
                    </span>
                  </span>
                </div>
              )}
          </div>
        </section>
      </Reveal>

      {result.hook.variations && result.hook.variations.length > 0 && (
        <Reveal>
          <section className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-6">
            <h3 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              Hook variations · text overlay candidates
            </h3>
            <ul className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
              {result.hook.variations.map((v, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.08, duration: 0.5 }}
                  whileHover={{ y: -3 }}
                  className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-4 transition-colors hover:border-emerald-900/60"
                >
                  <p className="mb-3 text-base font-medium leading-snug text-zinc-100">
                    &ldquo;{v.text}&rdquo;
                  </p>
                  <p className="mb-3 text-xs leading-relaxed text-zinc-400">
                    {v.rationale}
                  </p>
                  <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-emerald-400">
                    {v.estimated_impact}
                  </p>
                </motion.li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      {result.pacing.dead_zones && result.pacing.dead_zones.length > 0 && (
        <Reveal>
          <section className="rounded-2xl border border-rose-900/50 bg-gradient-to-br from-rose-950/20 via-zinc-950 to-zinc-950 p-6">
            <h3 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-rose-400">
              Dead zones · click to jump
            </h3>
            <ul className="space-y-3">
              {result.pacing.dead_zones.map((dz, i) => (
                <motion.li
                  key={i}
                  whileHover={{ x: 4 }}
                  className="flex cursor-pointer items-start gap-4 rounded-lg p-3 transition-colors hover:bg-rose-950/30"
                  onClick={() => seek(dz.start_sec)}
                >
                  <span className="font-mono text-xs tabular-nums text-rose-400">
                    {dz.start_sec.toFixed(1)}–{dz.end_sec.toFixed(1)}s
                  </span>
                  <span className="leading-relaxed text-zinc-300">
                    {dz.reason}
                  </span>
                </motion.li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      <Reveal>
        <section className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-6">
          <h3 className="mb-5 font-mono text-[10px] uppercase tracking-[0.25em] text-rose-400">
            Weaknesses · everything that will kill this reel
          </h3>
          <ul className="space-y-3">
            {result.overall.weaknesses.map((w, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.05 }}
                className="flex items-start gap-3 text-sm leading-relaxed text-zinc-300"
              >
                <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.7)]" />
                <span>{w}</span>
              </motion.li>
            ))}
          </ul>
        </section>
      </Reveal>
    </div>
  );
}

function CritiqueDiff({
  meta,
}: {
  meta: NonNullable<AnalysisResult["critique_meta"]>;
}) {
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-violet-900/50 bg-gradient-to-br from-violet-950/20 via-zinc-950 to-zinc-950 p-6">
      <header className="mb-3 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="mb-1 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-violet-400 shadow-[0_0_8px_currentColor]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-violet-400">
              self-critique · {meta.passes} passes
            </span>
          </div>
          <h3 className="font-serif text-2xl text-zinc-100">
            Score-ul a urcat de la{" "}
            <span className="font-medium tabular-nums text-zinc-400">
              {meta.initial_score}
            </span>{" "}
            la pass-ul critique
          </h3>
        </div>
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="rounded-full border border-violet-800/60 bg-violet-950/30 px-3 py-1.5 font-mono text-[10px] uppercase tracking-widest text-violet-300 hover:bg-violet-950/50"
        >
          {open ? "ascunde diff" : `vezi ${meta.changes.length} schimbări`}
        </button>
      </header>
      {open && (
        <ul className="mt-4 space-y-3 border-t border-violet-900/40 pt-4">
          {meta.changes.map((c, i) => (
            <li key={i} className="space-y-1">
              <div className="font-mono text-[10px] uppercase tracking-widest text-violet-400">
                {c.field}
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                <div className="rounded-lg border border-zinc-900 bg-zinc-950/60 p-3 text-xs leading-relaxed text-zinc-500 line-through opacity-70">
                  {c.before}
                </div>
                <div className="rounded-lg border border-violet-900/50 bg-violet-950/15 p-3 text-xs leading-relaxed text-violet-200">
                  {c.after}
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function ScoreBadge({ score }: { score: number }) {
  const tone =
    score >= 75
      ? {
          border: "border-emerald-700",
          glow: "shadow-[0_0_28px_rgba(16,185,129,0.18)]",
          text: "text-emerald-300",
          dot: "bg-emerald-400",
        }
      : score >= 50
        ? {
            border: "border-amber-700",
            glow: "shadow-[0_0_28px_rgba(245,158,11,0.18)]",
            text: "text-amber-300",
            dot: "bg-amber-400",
          }
        : {
            border: "border-rose-700",
            glow: "shadow-[0_0_28px_rgba(244,63,94,0.20)]",
            text: "text-rose-300",
            dot: "bg-rose-400",
          };
  return (
    <motion.div
      initial={{ scale: 0.9, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.2 }}
      className={`relative flex items-center gap-3 rounded-2xl border bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-5 py-3 ${tone.border} ${tone.glow}`}
    >
      <span
        className={`h-1.5 w-1.5 rounded-full ${tone.dot} shadow-[0_0_8px_currentColor]`}
      />
      <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
        Overall
      </span>
      <AnimatedNumber
        value={score}
        className={`text-4xl font-semibold tabular-nums ${tone.text}`}
      />
      <span className="text-xs text-zinc-600">/100</span>
    </motion.div>
  );
}

function TabButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-5 py-1.5 text-sm font-medium transition ${
        active
          ? "bg-zinc-100 text-zinc-900 shadow-[0_2px_12px_rgba(255,255,255,0.08)]"
          : "text-zinc-400 hover:text-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}
