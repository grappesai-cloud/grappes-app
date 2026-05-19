import { motion } from "motion/react";
import { useState, type CSSProperties } from "react";
import type { IntakeAnswers, IntakeContext } from "../../lib/reels/types";

type Props = {
  context: IntakeContext;
  onSubmit: (answers: IntakeAnswers) => void | Promise<void>;
  submitting?: boolean;
};

const S: Record<string, CSSProperties> = {
  card: {
    background:
      'linear-gradient(180deg, rgba(255,255,255,0.05) 0%, rgba(255,255,255,0.02) 100%), rgba(18,18,22,0.92)',
    backdropFilter: 'blur(24px) saturate(1.3)',
    WebkitBackdropFilter: 'blur(24px) saturate(1.3)',
    border: '1px solid rgba(255,255,255,0.09)',
    borderRadius: 20,
    boxShadow: '0 1px 0 rgba(255,255,255,0.05) inset, 0 12px 28px -16px rgba(0,0,0,0.5)',
    padding: '28px 32px',
    color: '#fff',
    fontFamily: 'Inter, system-ui, sans-serif',
  },
  eyebrow: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    fontSize: 11.5, fontWeight: 700,
    letterSpacing: '0.18em', textTransform: 'uppercase',
    color: '#a78bfa',
    padding: '5px 12px', borderRadius: 999,
    background: 'rgba(167,139,250,0.1)',
    border: '1px solid rgba(167,139,250,0.28)',
    marginBottom: 16,
  },
  eyebrowDot: {
    width: 6, height: 6, borderRadius: '50%',
    background: '#a78bfa',
    boxShadow: '0 0 8px rgba(167,139,250,0.6)',
  },
  title: {
    fontFamily: 'Inter, system-ui, sans-serif',
    fontSize: 'clamp(22px, 3vw, 30px)',
    fontWeight: 400, letterSpacing: '-0.025em', lineHeight: 1.15,
    color: '#fff', margin: '0 0 8px',
  },
  confidence: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: 10.5, fontWeight: 700,
    letterSpacing: '0.12em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.55)',
    padding: '4px 10px', borderRadius: 999,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
  },
  contextBox: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 14,
    padding: '16px 18px',
    margin: '22px 0 26px',
  },
  contextLabel: {
    fontSize: 10.5, fontWeight: 700,
    letterSpacing: '0.16em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.4)',
    marginBottom: 8,
  },
  contextSummary: {
    fontSize: 14, lineHeight: 1.55,
    color: 'rgba(255,255,255,0.85)',
    margin: 0,
  },
  tagsRow: {
    display: 'flex', flexWrap: 'wrap', gap: 6,
    marginTop: 12, listStyle: 'none', padding: 0,
  },
  tag: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 11, fontWeight: 600,
    padding: '4px 10px', borderRadius: 999,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    color: 'rgba(255,255,255,0.65)',
  },
  tagKey: { color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', letterSpacing: '0.04em', fontSize: 10 },
  qNumber: {
    fontSize: 10.5, fontWeight: 700,
    letterSpacing: '0.12em',
    color: 'rgba(255,255,255,0.4)',
    fontVariantNumeric: 'tabular-nums',
  },
  qLabel: { fontSize: 15, fontWeight: 500, color: '#fff', margin: 0 },
  qHelper: { fontSize: 12.5, color: 'rgba(255,255,255,0.5)', marginTop: 4, lineHeight: 1.5 },
  chipsRow: { display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 12 },
  chipBase: {
    padding: '8px 14px', borderRadius: 999,
    fontFamily: 'inherit', fontSize: 12, fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.15s',
  },
  chipInactive: {
    background: 'rgba(255,255,255,0.04)',
    color: 'rgba(255,255,255,0.7)',
    border: '1px solid rgba(255,255,255,0.12)',
  },
  chipActive: {
    background: 'rgba(167,139,250,0.18)',
    color: '#fff',
    border: '1px solid #a78bfa',
    boxShadow: '0 0 0 3px rgba(167,139,250,0.15)',
  },
  textInput: {
    width: '100%', maxWidth: 560, marginTop: 8,
    padding: '10px 14px', borderRadius: 11,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.12)',
    color: '#fff', fontFamily: 'inherit', fontSize: 14, outline: 'none',
  },
  foot: {
    marginTop: 30, paddingTop: 22,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    gap: 14, flexWrap: 'wrap',
    borderTop: '1px solid rgba(255,255,255,0.08)',
  },
  footMsg: {
    fontSize: 12, fontWeight: 600,
    letterSpacing: '0.08em', textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.5)',
  },
  submit: {
    display: 'inline-flex', alignItems: 'center', gap: 8,
    padding: '11px 22px', borderRadius: 999,
    fontFamily: 'inherit', fontSize: 13, fontWeight: 700,
    letterSpacing: '0.04em',
    background: '#a78bfa', color: '#0a0a0a',
    border: 'none', cursor: 'pointer',
    transition: 'all 0.2s',
  },
  submitDisabled: { opacity: 0.45, cursor: 'not-allowed' },
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
      style={S.card}
    >
      <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
        <div>
          <span style={S.eyebrow}><span style={S.eyebrowDot} /> Pre-analysis intake</span>
          <h2 style={S.title}>Before I dive in, let me confirm one assumption.</h2>
        </div>
        <span style={S.confidence}>Confidence · {context.inferred.confidence}</span>
      </header>

      <div style={S.contextBox}>
        <div style={S.contextLabel}>What I picked up</div>
        <p style={S.contextSummary}>{context.inferred.summary}</p>
        <ul style={S.tagsRow}>
          <Tag k="lang" v={context.inferred.language} />
          <Tag k="format" v={context.inferred.format_guess} />
          <Tag k="audience" v={context.inferred.audience_guess} />
        </ul>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 22 }}>
        {context.questions.map((q, idx) => (
          <motion.div
            key={q.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.08 * idx, duration: 0.4 }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4 }}>
              <span style={S.qNumber}>Q{String(idx + 1).padStart(2, '0')}</span>
              <p style={S.qLabel}>{q.label}</p>
            </div>
            {q.helper && <p style={S.qHelper}>{q.helper}</p>}
            {q.type === 'chip' && q.options ? (
              <div style={S.chipsRow}>
                {q.options.map((opt) => {
                  const active = answers[q.id] === opt.value;
                  return (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => set(q.id, opt.value)}
                      style={{ ...S.chipBase, ...(active ? S.chipActive : S.chipInactive) }}
                    >
                      {opt.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <input
                type="text"
                value={answers[q.id] ?? ''}
                onChange={(e) => set(q.id, e.target.value)}
                placeholder="(optional)"
                style={S.textInput}
              />
            )}
          </motion.div>
        ))}
      </div>

      <div style={S.foot}>
        <p style={S.footMsg}>
          {ready
            ? 'Ready — starting analysis with your context'
            : `Select ${required.filter((q) => !answers[q.id]).length} more option${required.filter((q) => !answers[q.id]).length === 1 ? '' : 's'}`}
        </p>
        <button
          type="button"
          disabled={!ready || submitting}
          onClick={submit}
          style={{ ...S.submit, ...(!ready || submitting ? S.submitDisabled : {}) }}
        >
          {submitting ? 'Sending…' : 'Start analysis →'}
        </button>
      </div>
    </motion.section>
  );
}

function Tag({ k, v }: { k: string; v: string }) {
  return (
    <li style={S.tag}>
      <span style={S.tagKey}>{k}</span>
      <span>{v}</span>
    </li>
  );
}
