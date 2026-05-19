import { motion } from "motion/react";
import type { Dimension, Moment, SequenceDimension } from "../../../lib/reels/types";
import { useState } from "react";
import AnimatedNumber from "./AnimatedNumber";
import SourceTag from "./SourceTag";
type Props = {
  title: string;
  via: string;
  description: string;
  data: Dimension | SequenceDimension;
  perSecond: boolean;
  duration: number;
  currentTime?: number;
  onMomentClick?: (sec: number) => void;
};
function interpolateAt(
  timeline: { sec: number; value: number }[],
  t: number,
): number {
  if (!timeline || timeline.length === 0) return 0;
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
}
export default function CognitiveCard({
  title,
  via,
  description,
  data,
  perSecond,
  duration,
  currentTime = 0,
  onMomentClick,
}: Props) {
  const score = data.score;
  const isPlaying = currentTime > 0;
  const live =
    perSecond && isPlaying
      ? Math.round(interpolateAt((data as Dimension).timeline, currentTime))
      : null;
  return (
    <motion.section
      initial={{ opacity: 0, y: 20 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}
      whileHover={{ y: -2 }}
      className="group relative overflow-hidden rounded-2xl border border-zinc-900 bg-gradient-to-br from-zinc-950 to-zinc-900/30 p-6 transition-colors hover:border-zinc-800"
    >
      <div className="absolute -right-16 -top-16 h-32 w-32 rounded-full bg-zinc-700/5 blur-3xl transition-opacity duration-500 group-hover:bg-zinc-500/10" />
      <header className="relative mb-5 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl font-normal tracking-tight text-zinc-100">
            {title}
          </h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            via {via}
          </p>
        </div>
        <SourceTag source="model" />
      </header>
      <div className="relative mb-4 flex flex-wrap items-center gap-2">
        <div className="inline-flex items-baseline gap-2 rounded-xl border border-zinc-900 bg-zinc-950/80 px-4 py-2.5">
          <span className="h-1.5 w-1.5 rounded-full bg-zinc-600" />
          <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
            score
          </span>
          <AnimatedNumber
            value={score}
            className="ml-1 text-3xl font-medium tabular-nums text-zinc-50"
          />
          <span className="text-xs text-zinc-600">/100</span>
        </div>
        {live != null && (
          <div className="inline-flex items-baseline gap-2 rounded-xl border border-emerald-900/60 bg-emerald-950/30 px-3 py-2.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_currentColor]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-emerald-400">
              now
            </span>
            <span className="ml-1 text-2xl font-medium tabular-nums text-emerald-200">
              {live}
            </span>
            <span className="text-xs text-emerald-700/80">/100</span>
          </div>
        )}
      </div>
      <p className="relative mb-5 max-w-prose text-sm leading-relaxed text-zinc-400">
        {description}
      </p>
      <div className="relative">
        {perSecond ? (
          <PerSecondChart
            data={data as Dimension}
            duration={duration}
            currentTime={currentTime}
            onMomentClick={onMomentClick}
            chartId={title.replace(/[^a-z0-9]/gi, "")}
          />
        ) : (
          <SequenceSummary data={data as SequenceDimension} />
        )}
      </div>
    </motion.section>
  );
}
function PerSecondChart({
  data,
  duration,
  currentTime = 0,
  onMomentClick,
  chartId,
}: {
  data: Dimension;
  duration: number;
  currentTime?: number;
  onMomentClick?: (sec: number) => void;
  chartId: string;
}) {
  const [open, setOpen] = useState(false);
  const W = 600;
  const H = 140;
  const PAD = 12;
  const points = data.timeline.map((p) => {
    const x = PAD + (p.sec / duration) * (W - PAD * 2);
    const y = PAD + (1 - p.value / 100) * (H - PAD * 2);
    return { x, y, sec: p.sec, value: p.value };
  });
  const pathD = buildSmoothPath(points);
  const areaD =
    points.length > 1
      ? `${pathD} L${points[points.length - 1].x.toFixed(1)},${(H - PAD).toFixed(1)} L${points[0].x.toFixed(1)},${(H - PAD).toFixed(1)} Z`
      : "";
  const gradId = `chart-grad-${chartId}`;
  const glowId = `chart-glow-${chartId}`;
  return (
    <div className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-4">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-36 w-full overflow-visible">
        <defs>
          <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(244,244,245,0.18)" />
            <stop offset="100%" stopColor="rgba(244,244,245,0)" />
          </linearGradient>
          <filter id={glowId} x="-20%" y="-20%" width="140%" height="140%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" />
            <feMerge>
              <feMergeNode />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
        </defs>
        <line
          x1={PAD}
          x2={W - PAD}
          y1={PAD}
          y2={PAD}
          stroke="rgba(255,255,255,0.06)"
        />
        <line
          x1={PAD}
          x2={W - PAD}
          y1={H / 2}
          y2={H / 2}
          stroke="rgba(255,255,255,0.06)"
          strokeDasharray="2 4"
        />
        <line
          x1={PAD}
          x2={W - PAD}
          y1={H - PAD}
          y2={H - PAD}
          stroke="rgba(255,255,255,0.06)"
        />
        {areaD && <path d={areaD} fill={`url(#${gradId})`} />}
        <path
          d={pathD}
          fill="none"
          stroke="rgba(255,255,255,0.95)"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
          filter={`url(#${glowId})`}
        />
        {data.moments.map((m, i) => {
          const x = PAD + (m.sec / duration) * (W - PAD * 2);
          const y = PAD + (1 - m.value / 100) * (H - PAD * 2);
          return (
            <MomentMarker
              key={i}
              x={x}
              y={y}
              moment={m}
              onClick={() => onMomentClick?.(m.sec)}
            />
          );
        })}
        {currentTime > 0 && duration > 0 && (() => {
          const x = PAD + (currentTime / duration) * (W - PAD * 2);
          const liveY =
            PAD +
            (1 - interpolateAt(data.timeline, currentTime) / 100) *
              (H - PAD * 2);
          return (
            <g>
              <line
                x1={x}
                x2={x}
                y1={PAD}
                y2={H - PAD}
                stroke="rgba(16,185,129,0.85)"
                strokeWidth="1.4"
              />
              <circle
                cx={x}
                cy={liveY}
                r="4.5"
                fill="#10b981"
                stroke="rgba(0,0,0,0.6)"
                strokeWidth="1"
              />
            </g>
          );
        })()}
      </svg>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-zinc-500">
        <span>0:00</span>
        <span>{formatTime(duration / 2)}</span>
        <span>{formatTime(duration)}</span>
      </div>
      <div className="mt-3 flex items-center gap-4 font-mono text-[10px] text-zinc-500">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-emerald-500">▲</span> peak
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="text-rose-500">▼</span> dip
        </span>
      </div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="mt-3 rounded-md border border-zinc-800 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-300 hover:bg-zinc-900"
      >
        {open ? "Hide" : "Show"} moments ({data.moments.length}) {open ? "▴" : "▾"}
      </button>
      {open && (
        <ul className="mt-3 space-y-2 border-t border-zinc-900 pt-3">
          {data.moments.map((m, i) => (
            <li
              key={i}
              className="flex cursor-pointer items-start gap-3 text-xs text-zinc-300 hover:text-zinc-100"
              onClick={() => onMomentClick?.(m.sec)}
            >
              <span className="mt-0.5 inline-flex h-4 min-w-10 items-center justify-center font-mono text-[10px] text-zinc-500">
                {formatTime(m.sec)}
              </span>
              <span
                className={`mt-0.5 inline-flex h-4 w-4 items-center justify-center rounded-sm text-[10px] ${
                  m.type === "peak"
                    ? "bg-emerald-950 text-emerald-400"
                    : "bg-rose-950 text-rose-400"
                }`}
              >
                {m.type === "peak" ? "▲" : "▼"}
              </span>
              <span className="leading-relaxed">{m.reason}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-4 text-xs leading-relaxed text-zinc-400">
        {data.summary}
      </p>
    </div>
  );
}
function buildSmoothPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return "";
  if (points.length === 1) return `M${points[0].x},${points[0].y}`;
  const parts: string[] = [`M${points[0].x.toFixed(1)},${points[0].y.toFixed(1)}`];
  for (let i = 0; i < points.length - 1; i++) {
    const p0 = points[i - 1] ?? points[i];
    const p1 = points[i];
    const p2 = points[i + 1];
    const p3 = points[i + 2] ?? p2;
    const cp1x = p1.x + (p2.x - p0.x) / 6;
    const cp1y = p1.y + (p2.y - p0.y) / 6;
    const cp2x = p2.x - (p3.x - p1.x) / 6;
    const cp2y = p2.y - (p3.y - p1.y) / 6;
    parts.push(
      `C${cp1x.toFixed(1)},${cp1y.toFixed(1)} ${cp2x.toFixed(1)},${cp2y.toFixed(1)} ${p2.x.toFixed(1)},${p2.y.toFixed(1)}`,
    );
  }
  return parts.join(" ");
}
function MomentMarker({
  x,
  y,
  moment,
  onClick,
}: {
  x: number;
  y: number;
  moment: Moment;
  onClick?: () => void;
}) {
  const color = moment.type === "peak" ? "#10b981" : "#f43f5e";
  return (
    <g
      transform={`translate(${x}, ${y})`}
      className="cursor-pointer"
      onClick={onClick}
    >
      <circle r="8" fill={color} fillOpacity="0.18" />
      <polygon
        points={moment.type === "peak" ? "0,-7 6,4 -6,4" : "0,7 6,-4 -6,-4"}
        fill={color}
        stroke="rgba(0,0,0,0.7)"
        strokeWidth="1"
      />
    </g>
  );
}
function SequenceSummary({ data }: { data: SequenceDimension }) {
  return (
    <div className="rounded-lg border border-zinc-900 bg-zinc-900/30 p-4">
      <p className="text-xs leading-relaxed text-zinc-400">{data.summary}</p>
      <p className="mt-3 rounded-md bg-zinc-900/60 p-3 text-[11px] leading-relaxed text-zinc-500">
        Comprehension is scored at the sequence level, so per-second activity
        isn&apos;t shown for this composite. The score above reflects the model&apos;s
        roll-up across the full run.
      </p>
    </div>
  );
}
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
