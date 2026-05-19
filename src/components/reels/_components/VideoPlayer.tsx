import { useEffect, useImperativeHandle, useRef, useState } from "react";
import type { EngagementTimeline, RawSignals } from "../../../lib/reels/types";
type DeadZone = { start_sec: number; end_sec: number; reason: string };
type Props = {
  videoUrl: string;
  duration: number;
  engagement: EngagementTimeline;
  signals?: RawSignals;
  deadZones?: DeadZone[];
  recommendedThumbnailSec?: number;
  onTimeChange?: (sec: number, playing: boolean) => void;
  ref?: React.Ref<VideoPlayerHandle>;
};
export type VideoPlayerHandle = {
  seek: (sec: number) => void;
  togglePlay: () => void;
  pause: () => void;
  play: () => void;
  showOverlay: (text: string, durationMs?: number) => void;
};
export default function VideoPlayer({
  videoUrl,
  duration,
  engagement,
  signals,
  deadZones,
  recommendedThumbnailSec,
  onTimeChange,
  ref,
}: Props) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [t, setT] = useState(0);
  const [overlay, setOverlay] = useState<string | null>(null);
  const overlayTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const showOverlay = (text: string, durationMs = 3000) => {
    if (overlayTimerRef.current) clearTimeout(overlayTimerRef.current);
    setOverlay(text);
    overlayTimerRef.current = setTimeout(() => setOverlay(null), durationMs);
  };
  useImperativeHandle(
    ref,
    () => ({
      seek: (sec: number) => {
        if (videoRef.current) {
          videoRef.current.currentTime = sec;
        }
      },
      togglePlay: () => {
        if (!videoRef.current) return;
        if (videoRef.current.paused) {
          videoRef.current.play();
        } else {
          videoRef.current.pause();
        }
      },
      pause: () => videoRef.current?.pause(),
      play: () => {
        void videoRef.current?.play();
      },
      showOverlay,
    }),
    [],
  );
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onTime = () => {
      setT(v.currentTime);
      onTimeChange?.(v.currentTime, !v.paused);
    };
    const onPlay = () => {
      setPlaying(true);
      onTimeChange?.(v.currentTime, true);
    };
    const onPause = () => {
      setPlaying(false);
      onTimeChange?.(v.currentTime, false);
    };
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("play", onPlay);
    v.addEventListener("pause", onPause);
    return () => {
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("play", onPlay);
      v.removeEventListener("pause", onPause);
    };
  }, [onTimeChange]);
  const seek = (sec: number) => {
    if (videoRef.current) videoRef.current.currentTime = sec;
  };
  const skip = (delta: number) => {
    if (videoRef.current) {
      videoRef.current.currentTime = Math.max(
        0,
        Math.min(duration, videoRef.current.currentTime + delta),
      );
    }
  };
  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play();
    else v.pause();
  };
  return (
    <div className="rounded-3xl border border-white/[0.08] bg-[rgba(14,14,18,0.65)] p-4 backdrop-blur-xl">
      <header className="mb-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-white/55">
            Your reel
          </span>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full border border-white/10 bg-white/[0.03] px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/55">
          <span className={`h-1 w-1 rounded-full ${playing ? "bg-emerald-300 shadow-[0_0_5px_currentColor]" : "bg-white/30"}`} />
          {playing ? "playing" : "ready"}
        </span>
      </header>
      <div className="relative flex justify-center rounded-2xl bg-black/95 ring-1 ring-white/[0.04]">
        <video
          ref={videoRef}
          src={videoUrl}
          className="max-h-[420px] rounded-2xl"
          playsInline
          preload="metadata"
        />
        {overlay && (
          <div className="pointer-events-none absolute inset-x-3 bottom-3 rounded-xl border border-white/15 bg-black/80 px-3 py-2.5 font-mono text-xs leading-relaxed text-white/90 backdrop-blur">
            <div className="mb-0.5 text-[9.5px] uppercase tracking-[0.18em] text-white/50">
              moment · paused
            </div>
            {overlay}
          </div>
        )}
      </div>
      <div className="mt-3">
        <p className="mb-1 font-mono text-[10px] uppercase tracking-[0.16em] text-white/40">
          Scrub the video · previews {0}/{engagement.moments.length}
        </p>
        <ScrubBar
          duration={duration}
          current={t}
          moments={engagement.moments}
          signals={signals}
          deadZones={deadZones}
          onSeek={seek}
        />
        <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-500">
          <span>0:00</span>
          <span>{formatTime(duration / 4)}</span>
          <span>{formatTime(duration / 2)}</span>
          <span>{formatTime((duration * 3) / 4)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>
      <div className="mt-4 flex items-center gap-2">
        <button
          type="button"
          onClick={() => skip(-10)}
          className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/70 transition hover:border-white/25 hover:text-white"
        >
          −10s
        </button>
        <button
          type="button"
          onClick={toggle}
          className="rounded-full bg-white px-5 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-black transition hover:bg-white/90"
        >
          {playing ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          onClick={() => skip(10)}
          className="rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/70 transition hover:border-white/25 hover:text-white"
        >
          +10s
        </button>
        <div className="ml-auto font-mono text-[11px] tabular-nums text-white/55">
          {formatTime(t)} / {formatTime(duration)}
        </div>
      </div>
      {recommendedThumbnailSec != null && (
        <button
          type="button"
          onClick={() => seek(recommendedThumbnailSec)}
          className="mt-3 inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/[0.02] px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.16em] text-white/65 transition hover:border-amber-300/30 hover:text-amber-200"
        >
          <span className="text-amber-300">★</span>
          <span>Jump to recommended thumbnail @ {formatTime(recommendedThumbnailSec)}</span>
        </button>
      )}
    </div>
  );
}
function ScrubBar({
  duration,
  current,
  moments,
  signals,
  deadZones,
  onSeek,
}: {
  duration: number;
  current: number;
  moments: EngagementTimeline["moments"];
  signals?: RawSignals;
  deadZones?: DeadZone[];
  onSeek: (sec: number) => void;
}) {
  const trackRef = useRef<HTMLDivElement>(null);
  const handleClick = (e: React.MouseEvent) => {
    if (!trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const pct = (e.clientX - rect.left) / rect.width;
    onSeek(pct * duration);
  };
  const W = 1000;
  const H = 56;
  const xOf = (sec: number) => (sec / duration) * W;
  // Per-clip min/max normalize so very quiet (ASMR) or very loud (DJ) reels
  // still show variation across the scrubber instead of flatlining.
  const normRange = (samples?: { value: number }[], fbLo = 0, fbHi = 1) => {
    if (!samples || samples.length < 2) return { lo: fbLo, hi: fbHi };
    const vs = samples.map((s) => s.value);
    const lo = Math.min(...vs);
    const hi = Math.max(...vs);
    if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < 1e-3) {
      return { lo: fbLo, hi: fbHi };
    }
    return { lo, hi };
  };
  const loudRange = normRange(signals?.loudness, -40, -10);
  const motionRange = normRange(signals?.motion, 0, 60);
  // Loudness — fill area normalized per-clip → 0..1
  const loudPath =
    signals?.loudness && signals.loudness.length >= 2
      ? (() => {
          const span = Math.max(loudRange.hi - loudRange.lo, 1e-3);
          const pts = signals.loudness.map((p) => ({
            x: xOf(p.sec),
            y:
              H -
              Math.max(0, Math.min(1, (p.value - loudRange.lo) / span)) * H,
          }));
          return [
            `M0,${H}`,
            ...pts.map((p) => `L${p.x.toFixed(1)},${p.y.toFixed(1)}`),
            `L${W},${H} Z`,
          ].join(" ");
        })()
      : "";
  // Motion — stroke line normalized per-clip
  const motionPath =
    signals?.motion && signals.motion.length >= 2
      ? (() => {
          const span = Math.max(motionRange.hi - motionRange.lo, 1e-3);
          const pts = signals.motion.map((p) => ({
            x: xOf(p.sec),
            y:
              H -
              Math.max(
                0,
                Math.min(1, (p.value - motionRange.lo) / span),
              ) *
                H *
                0.85,
          }));
          return pts
            .map(
              (p, i) =>
                (i === 0 ? "M" : "L") + p.x.toFixed(1) + "," + p.y.toFixed(1),
            )
            .join(" ");
        })()
      : "";
  // Find the moment closest to the playhead within ±0.8s for tooltip
  const nearestMoment = moments.find((m) => Math.abs(m.sec - current) < 0.8);
  const playheadPctX = (current / duration) * 100;
  return (
    <div className="relative">
      <div
        ref={trackRef}
        onClick={handleClick}
        className="relative h-14 cursor-pointer overflow-hidden rounded-md bg-zinc-900/60 ring-1 ring-zinc-900"
      >
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          className="pointer-events-none absolute inset-0 h-full w-full"
        >
          <defs>
            <linearGradient id="loud-fill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.32)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0.04)" />
            </linearGradient>
          </defs>
          {loudPath && <path d={loudPath} fill="url(#loud-fill)" />}
          {deadZones?.map((dz, i) => (
            <rect
              key={i}
              x={xOf(dz.start_sec)}
              width={xOf(dz.end_sec) - xOf(dz.start_sec)}
              y={0}
              height={H}
              fill="rgba(244,63,94,0.18)"
              stroke="rgba(244,63,94,0.45)"
              strokeWidth="0.6"
            />
          ))}
          {motionPath && (
            <path
              d={motionPath}
              fill="none"
              stroke="rgba(16,185,129,0.85)"
              strokeWidth="1.2"
              vectorEffect="non-scaling-stroke"
            />
          )}
        </svg>
        <div
          className="absolute inset-y-0 left-0 bg-emerald-900/10"
          style={{ width: `${playheadPctX}%` }}
        />
        <div
          className="absolute inset-y-0 w-px bg-emerald-400 shadow-[0_0_6px_rgba(16,185,129,0.7)]"
          style={{ left: `${playheadPctX}%` }}
        />
        {moments.map((m, i) => (
          <div
            key={i}
            className="absolute top-0 h-full w-2 -translate-x-1/2"
            style={{ left: `${(m.sec / duration) * 100}%` }}
            title={`${formatTime(m.sec)} · ${m.reason}`}
          >
            <div
              className={`absolute left-1/2 top-1.5 h-2.5 w-2.5 -translate-x-1/2 rounded-full ${
                m.type === "peak"
                  ? "bg-amber-400 shadow-[0_0_8px_rgba(252,211,77,0.7)]"
                  : "bg-rose-400 shadow-[0_0_8px_rgba(244,63,94,0.7)]"
              }`}
            />
          </div>
        ))}
      </div>
      {nearestMoment && (
        <div
          className="pointer-events-none absolute -top-2 z-10 -translate-x-1/2 -translate-y-full"
          style={{ left: `${playheadPctX}%` }}
        >
          <div
            className={`max-w-xs rounded-md border bg-zinc-950/95 px-2.5 py-1.5 font-mono text-[10px] leading-snug shadow-[0_4px_24px_rgba(0,0,0,0.6)] backdrop-blur ${
              nearestMoment.type === "peak"
                ? "border-amber-700/60 text-amber-200"
                : "border-rose-700/60 text-rose-200"
            }`}
          >
            <div className="mb-0.5 uppercase tracking-widest opacity-70">
              {nearestMoment.type === "peak" ? "▲ peak" : "▼ dip"} ·{" "}
              {formatTime(nearestMoment.sec)}
            </div>
            <div className="text-zinc-100 normal-case tracking-normal">
              {nearestMoment.reason}
            </div>
          </div>
        </div>
      )}
      <div className="mt-1.5 flex items-center gap-3 font-mono text-[9px] uppercase tracking-widest text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-zinc-300/40" />{" "}
          loudness
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-3 bg-emerald-400" /> motion
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="inline-block h-2 w-2 rounded-sm bg-rose-400/40" />{" "}
          dead zone
        </span>
      </div>
    </div>
  );
}
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
