import { motion } from "motion/react";
import { useEffect, useRef } from "react";
import type { HookVariation } from "../../../lib/reels/types";
type Props = {
  videoUrl: string;
  variations: HookVariation[];
  aspectRatio?: string;
  onSeek?: (sec: number) => void;
};
function aspectStyle(ratio?: string): React.CSSProperties {
  if (!ratio) return { aspectRatio: "9 / 16" };
  const m = ratio.match(/^(\d+)\s*[:x/]\s*(\d+)$/);
  if (!m) return { aspectRatio: "9 / 16" };
  return { aspectRatio: `${m[1]} / ${m[2]}` };
}
export default function HookMockups({
  videoUrl,
  variations,
  aspectRatio,
  onSeek,
}: Props) {
  if (!variations || variations.length === 0) return null;
  return (
    <section className="rounded-2xl border border-zinc-900 bg-zinc-950/60 p-6 lg:p-7">
      <header className="mb-5 flex items-baseline justify-between gap-3">
        <div>
          <h3 className="font-serif text-2xl tracking-tight text-zinc-100">
            Hook A/B preview
          </h3>
          <p className="mt-1 font-mono text-[10px] uppercase tracking-[0.2em] text-zinc-500">
            fiecare variantă peste primul frame · click ca să resetezi video-ul
          </p>
        </div>
        <span className="rounded-full border border-zinc-800 bg-zinc-900/60 px-2.5 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          {variations.length} variante
        </span>
      </header>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {variations.map((v, i) => (
          <HookCard
            key={i}
            index={i}
            variation={v}
            videoUrl={videoUrl}
            aspectStyle={aspectStyle(aspectRatio)}
            onClick={() => onSeek?.(0)}
          />
        ))}
      </div>
    </section>
  );
}
function HookCard({
  index,
  variation,
  videoUrl,
  aspectStyle,
  onClick,
}: {
  index: number;
  variation: HookVariation;
  videoUrl: string;
  aspectStyle: React.CSSProperties;
  onClick?: () => void;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    const onLoaded = () => {
      v.currentTime = 0.6;
    };
    v.addEventListener("loadeddata", onLoaded);
    return () => v.removeEventListener("loadeddata", onLoaded);
  }, []);
  return (
    <motion.button
      type="button"
      onClick={onClick}
      initial={{ opacity: 0, y: 14 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true }}
      transition={{ duration: 0.4, delay: index * 0.05 }}
      whileHover={{ y: -3 }}
      style={aspectStyle}
      className="group relative overflow-hidden rounded-xl bg-black ring-1 ring-zinc-900 transition-shadow hover:ring-emerald-700"
    >
      <video
        ref={ref}
        src={videoUrl}
        muted
        playsInline
        preload="metadata"
        className="absolute inset-0 h-full w-full object-cover"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/10 to-black/40" />
      <div className="absolute left-2 top-2 flex items-center gap-1.5 rounded-full bg-black/60 px-2 py-0.5 font-mono text-[9px] uppercase tracking-widest text-zinc-300 backdrop-blur">
        <span className="h-1 w-1 rounded-full bg-rose-500" />
        live
      </div>
      <div className="absolute left-3 right-3 top-1/4 -translate-y-1/2">
        <p
          className="text-balance text-center text-[15px] font-extrabold leading-tight text-white"
          style={{
            textShadow:
              "0 1px 0 rgba(0,0,0,0.7), 0 2px 8px rgba(0,0,0,0.55), 0 0 1px rgba(0,0,0,0.9)",
          }}
        >
          {variation.text}
        </p>
      </div>
      <div className="absolute inset-x-3 bottom-3">
        <div className="flex items-center justify-between font-mono text-[9px] uppercase tracking-widest text-white/70">
          <span>variation {index + 1}</span>
          <span className="rounded-full bg-emerald-500/90 px-2 py-0.5 text-[9px] text-emerald-950">
            {variation.estimated_impact.replace(/retenție.*$/i, "ret↑")}
          </span>
        </div>
        <p className="mt-1 line-clamp-2 text-[10px] leading-snug text-white/80">
          {variation.rationale}
        </p>
      </div>
    </motion.button>
  );
}
