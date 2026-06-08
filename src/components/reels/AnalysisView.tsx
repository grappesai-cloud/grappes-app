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

type Props = { id: string; initial: Analysis; readOnly?: boolean };

export default function AnalysisView({ id, initial, readOnly = false }: Props) {
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
  return <Dashboard row={row} result={result} readOnly={readOnly} />;
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
  readOnly = false,
}: {
  row: Analysis;
  result: AnalysisResult;
  readOnly?: boolean;
}) {
  const playerRef = useRef<VideoPlayerHandle>(null);
  const [tab, setTab] = useState<"summary" | "in_depth">("in_depth");
  const [videoTime, setVideoTime] = useState(0);
  const [isPublic, setIsPublic] = useState<boolean>(row.isPublic ?? false);
  const [shareState, setShareState] = useState<"idle" | "working" | "copied" | "error">("idle");

  async function handleShare() {
    setShareState("working");
    try {
      if (!isPublic) {
        const r = await fetch(`/api/reels/analysis/${row.id}/share`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ public: true }),
        });
        const data = await r.json();
        if (!r.ok) throw new Error(data.error || "Share failed");
        setIsPublic(true);
      }
      const link = `${window.location.origin}/reels/share/${row.id}`;
      try {
        await navigator.clipboard.writeText(link);
        setShareState("copied");
      } catch {
        window.prompt("Copy your public link:", link);
        setShareState("idle");
      }
      setTimeout(() => setShareState("idle"), 2200);
    } catch {
      setShareState("error");
      setTimeout(() => setShareState("idle"), 2600);
    }
  }

  // Performance-weighted headline + heavy-ranker, computed once and reused.
  const xRanking = result.x_signals ?? computeXRankingSignals(result);

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
        className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.04)_0%,rgba(255,255,255,0.01)_100%),rgba(14,14,18,0.85)] p-6 backdrop-blur-2xl lg:p-8"
      >
        <div className="pointer-events-none absolute -right-32 -top-32 h-72 w-72 rounded-full bg-violet-500/[0.08] blur-3xl" />
        <div className="pointer-events-none absolute -left-24 -bottom-24 h-56 w-56 rounded-full bg-cyan-500/[0.04] blur-3xl" />

        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-start">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                <span className="h-1 w-1 rounded-full bg-violet-300 shadow-[0_0_6px_currentColor]" />
                Reel · Analysis
              </span>
              {result.niche && (
                <span className="inline-flex items-center rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] font-medium uppercase tracking-[0.14em] text-white/70">
                  {result.niche.niche.replace(/_/g, " ")} · {result.niche.confidence}
                </span>
              )}
            </div>

            <h1 className="mt-5 max-w-2xl text-balance font-sans text-[clamp(28px,3.4vw,40px)] font-light leading-[1.1] tracking-[-0.025em] text-white">
              Here&apos;s what a social-graph ranker would do with this reel.
            </h1>

            <p className="mt-4 max-w-xl text-[13.5px] leading-relaxed text-white/50">
              We scored every second across attention, emotion, memory, decision and comprehension —
              then ran the same 10 signals an algorithmic feed uses to decide if you get boost or burial.
            </p>

            <dl className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 font-mono text-[10.5px] uppercase tracking-[0.14em] text-white/40">
              <MetaItem k="duration" v={`${result.meta.duration_sec.toFixed(1)}s`} />
              <MetaItem k="ratio" v={result.meta.aspect_ratio} />
              <MetaItem k="fps" v={`${result.meta.fps}`} />
              <MetaItem k="size" v={`${result.meta.file_size_mb}MB`} />
              <MetaItem k="file" v={row.fileName} truncate />
            </dl>

            <div className="mt-5 flex flex-wrap items-center gap-1.5">
              <SourceTag source="measured" />
              <SourceTag source="model" />
              <SourceTag source="estimated" />
            </div>
          </div>

          <div className="flex flex-col items-stretch gap-3 lg:items-end">
            <ScoreBadge score={xRanking.performance_score ?? result.overall.score} />
            {!readOnly && (
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <button
                  type="button"
                  onClick={handleShare}
                  disabled={shareState === "working"}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-3.5 py-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] transition ${
                    shareState === "copied"
                      ? "border-emerald-400/40 bg-emerald-400/10 text-emerald-300"
                      : shareState === "error"
                        ? "border-red-400/40 bg-red-400/10 text-red-300"
                        : "border-white/10 bg-white/[0.03] text-white/70 hover:border-white/25 hover:text-white"
                  }`}
                >
                  <span aria-hidden>
                    {shareState === "copied" ? "✓" : shareState === "working" ? "…" : "🔗"}
                  </span>
                  {shareState === "copied"
                    ? "Link copied"
                    : shareState === "error"
                      ? "Try again"
                      : isPublic
                        ? "Copy public link"
                        : "Create public link"}
                </button>
                {isPublic && shareState !== "copied" && (
                  <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-emerald-300/80">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" /> Public
                  </span>
                )}
              </div>
            )}
          </div>
        </div>
      </motion.header>

      <motion.section
        data-print-hide="true"
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
          <figure className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0%,rgba(255,255,255,0.01)_100%),rgba(14,14,18,0.85)] p-7 backdrop-blur-xl lg:p-9">
            <svg
              aria-hidden
              className="absolute left-6 top-6 h-7 w-7 text-white/15"
              viewBox="0 0 24 24"
              fill="currentColor"
            >
              <path d="M9.5 6c-3.6 0-6 2.7-6 6.3 0 3.4 2 5.7 4.8 5.7 1.6 0 2.8-.9 2.8-2.4 0-1.3-.8-2.1-1.9-2.1-.3 0-.6 0-.9.1.2-2.5 1.7-4.6 3.6-5.4L9.5 6Zm10 0c-3.6 0-6 2.7-6 6.3 0 3.4 2 5.7 4.8 5.7 1.6 0 2.8-.9 2.8-2.4 0-1.3-.8-2.1-1.9-2.1-.3 0-.6 0-.9.1.2-2.5 1.7-4.6 3.6-5.4L19.5 6Z" />
            </svg>
            <div className="relative pl-10">
              <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
                <span className="h-1 w-1 rounded-full bg-rose-300 shadow-[0_0_6px_currentColor]" />
                Verdict
              </span>
              <blockquote className="mt-4 max-w-4xl font-sans text-[clamp(18px,1.7vw,22px)] font-normal leading-[1.5] text-white/92">
                {result.overall.verdict}
              </blockquote>
            </div>
          </figure>
        </Reveal>
      )}

      <Reveal>
        <XSignalsCard data={xRanking} />
      </Reveal>

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
        <section className="rounded-3xl border border-white/[0.08] bg-[rgba(14,14,18,0.6)] p-6 backdrop-blur-xl lg:p-7">
          <header className="mb-3 flex items-baseline justify-between gap-4">
            <h3 className="text-[15px] font-medium tracking-tight text-white/90">
              How we score these
            </h3>
            <span className="rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
              Methodology
            </span>
          </header>
          <p className="max-w-prose text-[13.5px] leading-relaxed text-white/55">
            Every second of the video is scored across five things the brain does —
            attention, emotion, memory, decision and comprehension — then rolled up into
            the cards above. The peaks and dips on each chart are the moments viewers
            reacted noticeably more or less than the rest.
          </p>
        </section>
      </Reveal>

      <Reveal>
        <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.03)_0%,rgba(255,255,255,0.01)_100%),rgba(14,14,18,0.85)] p-7 backdrop-blur-xl lg:p-8">
          <div className="pointer-events-none absolute -left-16 -bottom-16 h-48 w-48 rounded-full bg-emerald-500/[0.08] blur-3xl" />
          <div className="relative">
            <header className="mb-6 flex items-center justify-between gap-4">
              <div className="flex items-center gap-2">
                <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-400/25 bg-emerald-400/[0.06] px-2.5 py-1 font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-emerald-200">
                  <span className="h-1 w-1 rounded-full bg-emerald-300 shadow-[0_0_6px_currentColor]" />
                  Top 3 actions
                </span>
                <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-white/35">
                  for the next cut
                </span>
              </div>
            </header>
            <ol className="space-y-3">
              {result.overall.top_3_actions.map((a, i) => {
                const meta = result.overall.top_3_actions_meta?.[i];
                return (
                  <li
                    key={i}
                    className="group flex gap-4 rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-emerald-400/20 hover:bg-emerald-400/[0.03]"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-emerald-400/30 bg-emerald-400/5 font-mono text-[11px] font-semibold tabular-nums text-emerald-200">
                      {String(i + 1).padStart(2, "0")}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <p className="text-[14.5px] leading-snug text-white/90">
                          {a}
                        </p>
                        {meta && (
                          <span
                            className="shrink-0 rounded-full border border-emerald-400/30 bg-emerald-400/[0.06] px-2.5 py-0.5 font-mono text-[10.5px] font-semibold tabular-nums text-emerald-200"
                            title={meta.rationale}
                          >
                            +{meta.delta}
                          </span>
                        )}
                      </div>
                      {meta && (
                        <p className="mt-1.5 text-[12.5px] leading-relaxed text-white/45">
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
                <div className="mt-5 flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.02] px-4 py-3">
                  <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-white/40">
                    Applying all 3
                  </span>
                  <span className="ml-auto flex items-baseline gap-1.5 font-mono text-[13px] tabular-nums">
                    <span className="text-white/55">{result.overall.score}</span>
                    <span className="text-white/30">→</span>
                    <span className="text-white">
                      {Math.min(
                        100,
                        result.overall.score +
                          result.overall.top_3_actions_meta.reduce((a, b) => a + b.delta, 0),
                      )}
                    </span>
                    <span className="text-emerald-300">
                      (+{result.overall.top_3_actions_meta.reduce((a, b) => a + b.delta, 0)})
                    </span>
                  </span>
                </div>
              )}
          </div>
        </section>
      </Reveal>

      {result.hook.variations && result.hook.variations.length > 0 && (
        <Reveal>
          <section className="rounded-3xl border border-white/[0.08] bg-[rgba(14,14,18,0.6)] p-7 backdrop-blur-xl">
            <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-medium tracking-tight text-white/90">
                Hook variations
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-white/35">
                text overlay candidates
              </span>
            </header>
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {result.hook.variations.map((v, i) => (
                <motion.li
                  key={i}
                  initial={{ opacity: 0, y: 12 }}
                  whileInView={{ opacity: 1, y: 0 }}
                  viewport={{ once: true }}
                  transition={{ delay: i * 0.06, duration: 0.45 }}
                  whileHover={{ y: -2 }}
                  className="flex flex-col rounded-2xl border border-white/[0.06] bg-white/[0.02] p-4 transition hover:border-white/15 hover:bg-white/[0.04]"
                >
                  <p className="mb-3 text-[14px] font-medium leading-snug text-white/95">
                    &ldquo;{v.text}&rdquo;
                  </p>
                  <p className="mb-4 text-[12.5px] leading-relaxed text-white/50">
                    {v.rationale}
                  </p>
                  <p className="mt-auto inline-flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-emerald-200">
                    <span className="h-1 w-1 rounded-full bg-emerald-300 shadow-[0_0_5px_currentColor]" />
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
          <section className="rounded-3xl border border-white/[0.08] bg-[rgba(14,14,18,0.6)] p-7 backdrop-blur-xl">
            <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
              <h3 className="text-[15px] font-medium tracking-tight text-white/90">
                Dead zones
              </h3>
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-rose-200/70">
                click to jump
              </span>
            </header>
            <ul className="divide-y divide-white/[0.05]">
              {result.pacing.dead_zones.map((dz, i) => (
                <motion.li
                  key={i}
                  whileHover={{ x: 3 }}
                  className="group flex cursor-pointer items-start gap-4 py-3 transition"
                  onClick={() => seek(dz.start_sec)}
                >
                  <span className="shrink-0 rounded-md border border-rose-400/25 bg-rose-400/[0.06] px-2 py-0.5 font-mono text-[11px] tabular-nums text-rose-200">
                    {dz.start_sec.toFixed(1)}–{dz.end_sec.toFixed(1)}s
                  </span>
                  <span className="text-[13.5px] leading-relaxed text-white/75 group-hover:text-white">
                    {dz.reason}
                  </span>
                </motion.li>
              ))}
            </ul>
          </section>
        </Reveal>
      )}

      <Reveal>
        <section className="rounded-3xl border border-white/[0.08] bg-[rgba(14,14,18,0.6)] p-7 backdrop-blur-xl">
          <header className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="text-[15px] font-medium tracking-tight text-white/90">
              Weaknesses
            </h3>
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-rose-200/70">
              what will kill this reel
            </span>
          </header>
          <ul className="space-y-2.5">
            {result.overall.weaknesses.map((w, i) => (
              <motion.li
                key={i}
                initial={{ opacity: 0, x: -8 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ delay: i * 0.04 }}
                className="flex items-start gap-3 text-[13.5px] leading-relaxed text-white/80"
              >
                <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-rose-300 shadow-[0_0_6px_currentColor]" />
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

function MetaItem({ k, v, truncate }: { k: string; v: string; truncate?: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 ${truncate ? "min-w-0 max-w-[260px]" : ""}`}>
      <span className="text-white/30">{k}</span>
      <span className={`text-white/70 normal-case tracking-normal ${truncate ? "truncate" : ""}`}>{v}</span>
    </div>
  );
}

function ScoreBadge({ score }: { score: number }) {
  // Bands track the heavy-ranker cutoffs (boosted ≥62 / neutral ≥46) since this
  // is now the performance composite, not the model's craft gestalt.
  const tone =
    score >= 62
      ? { label: "Strong", accent: "#34d399", glow: "rgba(52,211,153,0.16)" }
      : score >= 46
        ? { label: "Mid", accent: "#fbbf24", glow: "rgba(251,191,36,0.16)" }
        : { label: "Weak", accent: "#fb7185", glow: "rgba(251,113,133,0.18)" };
  return (
    <motion.div
      initial={{ scale: 0.92, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      transition={{ duration: 0.6, delay: 0.15 }}
      className="relative flex min-w-[200px] items-center gap-4 rounded-2xl border border-white/10 bg-[rgba(14,14,18,0.7)] px-5 py-4 backdrop-blur"
      style={{ boxShadow: `0 0 32px -8px ${tone.glow}` }}
    >
      <div className="flex flex-col">
        <span className="font-mono text-[9.5px] uppercase tracking-[0.22em] text-white/40">
          Performance
        </span>
        <span
          className="mt-0.5 inline-flex items-center gap-1.5 font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em]"
          style={{ color: tone.accent }}
        >
          <span
            className="h-1 w-1 rounded-full"
            style={{ background: tone.accent, boxShadow: `0 0 6px ${tone.accent}` }}
          />
          {tone.label}
        </span>
      </div>
      <div className="ml-auto flex items-baseline gap-1">
        <AnimatedNumber
          value={score}
          className="text-[44px] font-light leading-none tabular-nums text-white"
        />
        <span className="text-[11px] font-medium text-white/35">/100</span>
      </div>
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
