import type { ReactNode } from "react";
type Tone = "default" | "emerald" | "rose" | "amber";
const tones: Record<Tone, string> = {
  default:
    "border-zinc-800 bg-zinc-900/60 text-zinc-400 hover:text-zinc-200",
  emerald:
    "border-emerald-900/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-950/70",
  rose: "border-rose-900/60 bg-rose-950/40 text-rose-300 hover:bg-rose-950/70",
  amber:
    "border-amber-900/40 bg-amber-950/30 text-amber-300 hover:bg-amber-950/50",
};
export default function Pill({
  children,
  tone = "default",
  onClick,
  className,
}: {
  children: ReactNode;
  tone?: Tone;
  onClick?: () => void;
  className?: string;
}) {
  const interactive = onClick != null;
  const Comp = interactive ? "button" : "span";
  return (
    <Comp
      type={interactive ? "button" : undefined}
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 font-mono text-[10px] uppercase tracking-[0.2em] transition ${tones[tone]} ${className ?? ""}`}
    >
      {children}
    </Comp>
  );
}
