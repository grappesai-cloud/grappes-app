import { motion } from "motion/react";
import { useState } from "react";
import type { IntakeAnswers, IntakeContext } from "../../lib/reels/types";
type Props = {
  context: IntakeContext;
  onSubmit: (answers: IntakeAnswers) => void | Promise<void>;
  submitting?: boolean;
};
export default function IntakeForm({ context, onSubmit, submitting }: Props) {
  const [answers, setAnswers] = useState<IntakeAnswers>(() => {
    const seed: IntakeAnswers = {};
    for (const q of context.questions) {
      if (q.inferred_default) seed[q.id] = q.inferred_default;
    }
    return seed;
  });
  const set = (id: string, value: string) =>
    setAnswers((prev) => ({ ...prev, [id]: value }));
  const required = context.questions.filter((q) => q.type === "chip");
  const ready = required.every((q) => !!answers[q.id]);
  const submit = async () => {
    if (!ready || submitting) return;
    await onSubmit(answers);
  };
  return (
    <motion.section
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-zinc-900 bg-gradient-to-br from-zinc-950 to-zinc-900/40 p-6 lg:p-8"
    >
      <header className="mb-6 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400 shadow-[0_0_8px_currentColor]" />
            <span className="font-mono text-[10px] uppercase tracking-[0.25em] text-amber-400">
              Haiku · pre-analysis intake
            </span>
          </div>
          <h2 className="font-serif text-3xl tracking-tight text-zinc-50">
            Înainte să dau drumul la analiză, lasă-mă să verific o presupunere.
          </h2>
        </div>
        <div className="rounded-full border border-zinc-800 bg-zinc-900/60 px-3 py-1 font-mono text-[10px] uppercase tracking-widest text-zinc-400">
          confidence · {context.inferred.confidence}
        </div>
      </header>
      <div className="mb-7 rounded-xl border border-zinc-900 bg-zinc-950/70 p-4">
        <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
          ce am dedus
        </div>
        <p className="text-base leading-relaxed text-zinc-200">
          {context.inferred.summary}
        </p>
        <ul className="mt-3 flex flex-wrap gap-2 font-mono text-[10px] uppercase tracking-widest">
          <Tag label="lang" value={context.inferred.language} />
          <Tag label="format" value={context.inferred.format_guess} />
          <Tag label="audience" value={context.inferred.audience_guess} />
        </ul>
      </div>
      <div className="space-y-6">
        {context.questions.map((q, idx) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * idx, duration: 0.4 }}
          >
            <div className="mb-2 flex items-baseline gap-3">
              <span className="font-mono text-[10px] tabular-nums text-zinc-600">
                Q{String(idx + 1).padStart(2, "0")}
              </span>
              <p className="text-base text-zinc-100">{q.label}</p>
            </div>
            {q.helper && (
              <p className="mb-3 pl-8 text-xs leading-relaxed text-zinc-500">
                {q.helper}
              </p>
            )}
            <div className="pl-8">
              {q.type === "chip" && q.options ? (
                <div className="flex flex-wrap gap-2">
                  {q.options.map((opt) => {
                    const active = answers[q.id] === opt.value;
                    return (
                      <button
                        key={opt.value}
                        type="button"
                        onClick={() => set(q.id, opt.value)}
                        className={`rounded-full border px-3.5 py-1.5 font-mono text-[11px] uppercase tracking-widest transition ${
                          active
                            ? "border-emerald-700 bg-emerald-950/40 text-emerald-200 shadow-[0_0_12px_rgba(16,185,129,0.18)]"
                            : "border-zinc-800 bg-zinc-900/40 text-zinc-400 hover:border-zinc-700 hover:text-zinc-200"
                        }`}
                      >
                        {opt.label}
                      </button>
                    );
                  })}
                </div>
              ) : (
                <input
                  type="text"
                  value={answers[q.id] ?? ""}
                  onChange={(e) => set(q.id, e.target.value)}
                  placeholder="(opțional)"
                  className="w-full max-w-xl rounded-lg border border-zinc-800 bg-zinc-950/60 px-3 py-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-emerald-700 focus:outline-none"
                />
              )}
            </div>
          </motion.div>
        ))}
      </div>
      <div className="mt-8 flex items-center justify-between border-t border-zinc-900 pt-5">
        <p className="font-mono text-[10px] uppercase tracking-[0.25em] text-zinc-500">
          {ready
            ? "ready — Sonnet pornește cu contextul tău"
            : `selectează ${required.filter((q) => !answers[q.id]).length} opțiuni rămase`}
        </p>
        <button
          type="button"
          disabled={!ready || submitting}
          onClick={submit}
          className={`rounded-full px-5 py-2 font-mono text-[11px] uppercase tracking-widest transition ${
            ready && !submitting
              ? "bg-zinc-100 text-zinc-900 hover:bg-white"
              : "cursor-not-allowed bg-zinc-900 text-zinc-600"
          }`}
        >
          {submitting ? "trimitem…" : "Pornește analiza →"}
        </button>
      </div>
    </motion.section>
  );
}
function Tag({ label, value }: { label: string; value: string }) {
  return (
    <li className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/40 px-2.5 py-1 text-zinc-400">
      <span className="text-zinc-600">{label}</span>
      <span className="text-zinc-200">{value}</span>
    </li>
  );
}
