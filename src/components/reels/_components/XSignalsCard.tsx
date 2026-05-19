import { motion } from "motion/react";
import type { XRankingSignals, XSignal } from "../../../lib/reels/types";
import AnimatedNumber from "./AnimatedNumber";
import SourceTag from "./SourceTag";
type Props = {
  data: XRankingSignals;
};
const BAND_THEME = {
  boosted: {
    border: "border-emerald-700",
    glow: "shadow-[0_0_28px_rgba(16,185,129,0.18)]",
    text: "text-emerald-300",
    dot: "bg-emerald-400",
    bar: "bg-emerald-500",
    accent: "text-emerald-400",
    badge: "border-emerald-800/60 bg-emerald-950/40 text-emerald-300",
  },
  neutral: {
    border: "border-amber-700",
    glow: "shadow-[0_0_28px_rgba(245,158,11,0.18)]",
    text: "text-amber-300",
    dot: "bg-amber-400",
    bar: "bg-amber-500",
    accent: "text-amber-400",
    badge: "border-amber-800/60 bg-amber-950/40 text-amber-300",
  },
  throttled: {
    border: "border-rose-700",
    glow: "shadow-[0_0_28px_rgba(244,63,94,0.20)]",
    text: "text-rose-300",
    dot: "bg-rose-400",
    bar: "bg-rose-500",
    accent: "text-rose-400",
    badge: "border-rose-800/60 bg-rose-950/40 text-rose-300",
  },
} as const;
const BAND_LABEL: Record<XRankingSignals["band"], string> = {
  boosted: "Would BOOST",
  neutral: "Neutral",
  throttled: "Would THROTTLE",
};
export default function XSignalsCard({ data }: Props) {
  const theme = BAND_THEME[data.band];
  const sorted = [...data.signals].sort((a, b) => b.score - a.score);
  return (
    <motion.section
      initial={{ opacity: 0, y: 24 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: "-50px" }}
      transition={{ duration: 0.7, ease: [0.22, 1, 0.36, 1] }}
      className="relative overflow-hidden rounded-2xl border border-zinc-900 bg-gradient-to-br from-zinc-950 via-zinc-950 to-zinc-900/60 p-6 lg:p-8"
    >
      <div
        className={`absolute -right-16 -top-16 h-40 w-40 rounded-full blur-3xl ${
          data.band === "boosted"
            ? "bg-emerald-700/15"
            : data.band === "neutral"
              ? "bg-amber-700/15"
              : "bg-rose-700/15"
        }`}
      />
      <header className="relative mb-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              X-style heavy ranker · inspired by xai-org/x-algorithm
            </span>
            <SourceTag source="measured" />
          </div>
          <h3 className="font-serif text-3xl font-normal tracking-tight text-zinc-50 lg:text-4xl">
            How a social-graph ranker would score this
          </h3>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-zinc-400">
            Ten heavy-ranker signals X uses to decide if a piece gets boosted,
            shown sliced for this reel. Weights mirror the public 2023 release;
            inputs come from your measured pipeline data — not vibes.
          </p>
        </div>
        <motion.div
          initial={{ scale: 0.9, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className={`relative flex flex-col items-end gap-2 rounded-2xl border bg-gradient-to-br from-zinc-950 via-zinc-900 to-zinc-950 px-5 py-3 ${theme.border} ${theme.glow}`}
        >
          <div className="flex items-baseline gap-3">
            <span
              className={`h-1.5 w-1.5 rounded-full ${theme.dot} shadow-[0_0_8px_currentColor]`}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
              heavy ranker
            </span>
            <AnimatedNumber
              value={data.heavy_ranker_score}
              className={`text-4xl font-semibold tabular-nums ${theme.text}`}
            />
            <span className="text-xs text-zinc-600">/100</span>
          </div>
          <span
            className={`rounded-full border px-2.5 py-0.5 font-mono text-[10px] uppercase tracking-[0.2em] ${theme.badge}`}
          >
            {BAND_LABEL[data.band]}
          </span>
        </motion.div>
      </header>
      <div className="relative mb-6 rounded-xl border border-zinc-900 bg-zinc-950/60 p-4">
        <p className="text-sm leading-relaxed text-zinc-300">
          <span className={`mr-2 font-mono text-[10px] uppercase tracking-widest ${theme.accent}`}>
            verdict
          </span>
          {data.rationale}
        </p>
      </div>
      <ol className="relative space-y-2">
        {sorted.map((s, i) => (
          <SignalRow
            key={s.id}
            signal={s}
            index={i}
            band={data.band}
          />
        ))}
      </ol>
      <p className="relative mt-6 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        Σ weights = {Math.round(
          data.signals.reduce((a, s) => a + s.weight, 0) * 100,
        )}
        % · band cutoffs: ≥72 boosted, ≥50 neutral, &lt;50 throttled
      </p>
    </motion.section>
  );
}
function SignalRow({
  signal,
  index,
  band,
}: {
  signal: XSignal;
  index: number;
  band: XRankingSignals["band"];
}) {
  const themeBar =
    signal.score >= 72
      ? "bg-emerald-500"
      : signal.score >= 50
        ? "bg-amber-500"
        : "bg-rose-500";
  const themeText =
    signal.score >= 72
      ? "text-emerald-300"
      : signal.score >= 50
        ? "text-amber-300"
        : "text-rose-300";
  const _band = band; // band is intentionally available for future per-row treatments
  void _band;
  return (
    <motion.li
      initial={{ opacity: 0, x: -12 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true }}
      transition={{ delay: 0.05 * index, duration: 0.4 }}
      className="rounded-lg border border-zinc-900 bg-zinc-900/30 px-4 py-3 transition-colors hover:border-zinc-800"
    >
      <div className="mb-1.5 flex items-baseline justify-between gap-4">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            {String(index + 1).padStart(2, "0")}
          </span>
          <span className="text-sm font-medium text-zinc-200">
            {signal.label}
          </span>
          <span className="rounded-sm border border-zinc-800 bg-zinc-950/60 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-500">
            ×{signal.weight.toFixed(2)}
          </span>
          <SourceTag source={signal.source} />
        </div>
        <div className="flex items-baseline gap-2 font-mono text-[11px] tabular-nums">
          <span className={themeText}>{signal.score}</span>
          <span className="text-zinc-600">/100</span>
          <span className="text-zinc-600">·</span>
          <span className="text-zinc-400">+{Math.round(signal.contribution * 100) / 100}</span>
        </div>
      </div>
      <div className="relative h-1.5 overflow-hidden rounded-full bg-zinc-900">
        <motion.div
          initial={{ width: 0 }}
          whileInView={{ width: `${signal.score}%` }}
          viewport={{ once: true }}
          transition={{ duration: 0.7, delay: 0.05 * index, ease: "easeOut" }}
          className={`h-full ${themeBar}`}
        />
      </div>
      <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-zinc-500">
        {signal.detail}
      </p>
    </motion.li>
  );
}
