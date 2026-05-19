import { motion } from "motion/react";
import type { EngagementTimeline as ET } from "../../../lib/reels/types";
import Pill from "./Pill";
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
type Props = {
  data: ET;
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
export default function EngagementTimeline({
  data,
  duration,
  currentTime = 0,
  onMomentClick,
}: Props) {
  const W = 1200;
  const H = 200;
  const PAD = 16;
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
  return (
    <section className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-6 lg:p-7">
      <header className="mb-5 flex items-baseline justify-between">
        <h3 className="font-serif text-2xl font-normal tracking-tight text-zinc-100">
          Engagement timeline
        </h3>
        <Pill>across {formatTime(duration)}</Pill>
      </header>
      <div className="rounded-xl border border-zinc-900 bg-zinc-900/30 p-4 lg:p-5">
        <svg viewBox={`0 0 ${W} ${H}`} className="h-48 w-full overflow-visible">
          <defs>
            <linearGradient id="engagement-area" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="rgba(255,255,255,0.16)" />
              <stop offset="100%" stopColor="rgba(255,255,255,0)" />
            </linearGradient>
            <filter id="engagement-glow" x="-10%" y="-30%" width="120%" height="160%">
              <feGaussianBlur in="SourceGraphic" stdDeviation="2" />
              <feMerge>
                <feMergeNode />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>
          {[0.25, 0.5, 0.75].map((p) => (
            <line
              key={p}
              x1={PAD}
              x2={W - PAD}
              y1={PAD + p * (H - PAD * 2)}
              y2={PAD + p * (H - PAD * 2)}
              stroke="rgba(255,255,255,0.05)"
              strokeDasharray={p === 0.5 ? "2 4" : undefined}
            />
          ))}
          {areaD && <path d={areaD} fill="url(#engagement-area)" />}
          <path
            d={pathD}
            fill="none"
            stroke="rgba(255,255,255,0.96)"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            filter="url(#engagement-glow)"
          />
          {data.moments.map((m, i) => {
            const x = PAD + (m.sec / duration) * (W - PAD * 2);
            const y = PAD + (1 - m.value / 100) * (H - PAD * 2);
            const color = m.type === "peak" ? "#10b981" : "#f43f5e";
            return (
              <g
                key={i}
                transform={`translate(${x}, ${y})`}
                className="cursor-pointer"
                onClick={() => onMomentClick?.(m.sec)}
              >
                <circle r="10" fill={color} fillOpacity="0.18" />
                <polygon
                  points={
                    m.type === "peak" ? "0,-9 7,5 -7,5" : "0,9 7,-5 -7,-5"
                  }
                  fill={color}
                  stroke="rgba(0,0,0,0.7)"
                  strokeWidth="1"
                />
              </g>
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
                  strokeWidth="1.6"
                />
                <circle
                  cx={x}
                  cy={liveY}
                  r="6"
                  fill="#10b981"
                  stroke="rgba(0,0,0,0.6)"
                  strokeWidth="1.2"
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
      </div>
      <div className="mt-5 flex flex-wrap gap-2">
        {data.moments.map((m, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, scale: 0.9 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            transition={{ delay: i * 0.05 }}
          >
            <Pill
              tone={m.type === "peak" ? "emerald" : "rose"}
              onClick={() => onMomentClick?.(m.sec)}
            >
              <span>{m.type === "peak" ? "▲" : "▼"}</span>
              <span className="tabular-nums">{formatTime(m.sec)}</span>
              <span className="text-zinc-500">
                attention {m.type === "peak" ? "peak" : "drop"}
              </span>
            </Pill>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
