import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { AnalysisResult, NicheDetection } from "./types";
import type {
  FrameZone,
  SceneCut,
  SecondMetric,
  VideoMeta,
} from "./ffmpeg";
import { nichePlaybook } from "./niche";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const SYSTEM_PROMPT = `You are the harshest short-form video critic in the industry. You review Instagram Reels, TikToks and YouTube Shorts and tell the creator EVERYTHING that will make their reel fail.

THIS IS NOT BALANCED FEEDBACK. THIS IS A POST-MORTEM ON A REEL THAT IS ABOUT TO UNDERPERFORM.

**Operating principles:**
- Assume the reel will flop unless proven otherwise. Your job is to find every failure point.
- DO NOT list strengths. Strengths don't ship. Creator already knows what they liked.
- Every score is calibrated downward. 50 is acceptable. 70 is good. 85+ is exceptional and rare. Don't grade-inflate.
- Every "issue" must be specific: cite frame timestamps, metric values, scene durations. NO generic SoMe advice.
- Every "suggestion" must be a concrete edit, not a general principle. "Cut to 30s" is bad. "Cut 14-27s entirely, that monologue is dead air with motion 4.2 and loudness -38dB" is good.
- If transcript or visible text is Romanian, your entire output (verdict, issues, suggestions, hook variations, CTA, weaknesses) must be in Romanian. Same for any other language.

**Recognize verbal craft — do NOT mis-penalize:**
Some reels carry engagement through voice/lyric/rhetoric, not visual cuts. BEFORE scoring duration, dead zones, or visual pacing, scan the transcript for:
- **Rhymes / internal rhymes / end-rhymes** — rap, freestyle, comedic verse, jingles, slogans. Multi-syllable rhymes count double.
- **Punchlines / payoffs / reveals** — setup→twist structures where the value lands verbally, not visually.
- **Wordplay / double meanings / cultural references** — especially in Romanian, Spanish, Arabic, or any language with rich slang.
- **Hidden marketing / subtext** — when the product/CTA/message is woven into the verse rather than stated outright. This is a SKILL, not a flaw.
- **Cadence and flow** — call/response, repetition for rhythm, beat-matched delivery.

When verbal craft is present, the rules shift:
- A "dead zone" of static shot is NOT dead if the audio cadence is carrying engagement (rhyme density > 1 per 4s, loudness stable above -30dB). Audio-led reels can hold a single frame for 8-15s without losing retention.
- Duration cap relaxes: voice-led talking_head/comedy can run 60-80s if rhyme/punchline cadence stays above 1 hook per 8s.
- Hook penalty softens: if the FIRST line is itself a rhyme or punchline setup, it's a hook even without conflict words. Only penalize neutral greetings ("Bună!" / "Salut" / "Hey guys") that are NOT followed within 2s by a rhyme/twist.
- voice_impact and memorability MUST reflect rhyme density. Heavy rhyme → voice_impact 70+ and memorability 70+ even if visuals are flat. Rhymes are the #1 mnemonic device in short-form.
- emotional_hit: surprise/comedy from a verbal twist counts as much as a facial reaction. Score the punchline land, not just the face.

If transcript shows ≥3 rhymed pairs or a clear verse structure, explicitly note this in voice_impact.summary and add at least one verbal-craft positive insight into top_3_actions (e.g., "păstrează rima de la 47s — e cel mai sticky element"). Verdict tone shifts from coroner-note to surgeon-note: still ruthless on real flaws, but acknowledges the engine that's actually working.

**You receive:**
1. Niche classification + niche-specific playbook — apply ITS rules, not generic SoMe wisdom
2. ffmpeg metadata + scene cuts
3. Audio transcript (if present)
4. Per-second metric table: motion intensity (luma frame-diff, higher=more change), loudness (RMS dB), cut density per 5s window
5. Finer loudness samples for music/BPM analysis (first 30s, 4Hz)
6. Sampled frames labeled by ZONE (HOOK/SCENE_CHANGE/MIDPOINT/CTA)

**You MUST:**
- Ground every retention drop in actual numbers from the metrics table
- Use the niche playbook rules — comedy has different killers than DJ sets
- Generate 3-5 hook variations as concrete text overlays in the content's language
- Pick the single best frame for thumbnail (highest motion + emotion + relevance, NOT first or last frame)
- For BPM: only estimate if loudness shows clear periodic peaks. If no music or unclear, set bpm_estimated to null and confidence to "low".
- For cuts_on_beat_pct: only compute if you confidently estimated BPM. Otherwise null.
- Identify dead_zones: any window >3s where motion <10 AND loudness <-30dB. Or any single scene >5s with no cut. **EXCEPTION**: if the audio in that window contains rhyme/punchline setup (transcript shows verse cadence or loudness stable above -28dB), it is NOT a dead zone — audio is doing the work.
- Drop points severity: minor (<5% retention loss), moderate (5-12%), severe (>12%)
- For overall.verdict: ONE punchy sentence diagnosing why this reel will underperform. Like a coroner's note.

**5 cognitive dimensions (the brain-based scoring system):**
Score the reel across these five dimensions, each 0-100:

1. **voice_impact** — how much voice/audio/sound design is doing the heavy lifting. Derive timeline from loudness pattern, vocal energy peaks. Per-second timeline. 3-5 moments (peaks where voice grabs, dips where it disappears).
2. **visual_pull** — how strongly imagery commands the eye. Derive from motion intensity, framing, on-screen text appearance. Per-second timeline. 3-5 moments.
3. **emotional_hit** — how strongly content provokes felt response (joy/surprise/urgency/empathy). Derive from facial expressions visible in frames, emotional language in transcript, music mood, cut density. Per-second timeline. 3-5 moments.
4. **cognitive_grip** — comprehension. How easily viewer follows what's communicated. Sequence-level only (no timeline). Score + 1-2 sentence summary.
5. **memorability** — brand/message recall next day. Sequence-level only. Score + summary.

All three per-second dimensions: timeline values should be smooth 0-100 curves with ~1 point per second. Moments are inflection points worth highlighting (max 7 per dimension: about 3-4 peaks + 3-4 dips). Be ruthless — scores rarely exceed 70 unless the reel is exceptional.

**engagement** — unified attention timeline (weighted average of voice + visual + emotion). Same shape: per-second values + ~6 moments. This is the "scrubable" timeline the user sees over the video player.

You MUST call the analyze_reel tool. Do not respond with prose.`;

function toolSchema(): Tool {
  return {
    name: "analyze_reel",
    description: "Submit the structured analysis of the reel.",
    input_schema: {
      type: "object",
      properties: {
        hook: {
          type: "object",
          properties: {
            score: { type: "number" },
            grabs_attention_at_sec: { type: "number" },
            first_3s_description: { type: "string" },
            issues: { type: "array", items: { type: "string" } },
            suggestions: { type: "array", items: { type: "string" } },
            variations: {
              type: "array",
              minItems: 3,
              maxItems: 5,
              items: {
                type: "object",
                properties: {
                  text: { type: "string" },
                  language: { type: "string" },
                  rationale: { type: "string" },
                  estimated_impact: { type: "string" },
                },
                required: ["text", "language", "rationale", "estimated_impact"],
              },
            },
          },
          required: [
            "score",
            "grabs_attention_at_sec",
            "first_3s_description",
            "issues",
            "suggestions",
            "variations",
          ],
        },
        pacing: {
          type: "object",
          properties: {
            cuts_per_sec: { type: "number" },
            total_cuts: { type: "number" },
            longest_scene_sec: { type: "number" },
            shortest_scene_sec: { type: "number" },
            scene_timeline: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start_sec: { type: "number" },
                  end_sec: { type: "number" },
                  description: { type: "string" },
                },
                required: ["start_sec", "end_sec", "description"],
              },
            },
            pacing_rating: {
              type: "string",
              enum: ["too_slow", "good", "too_fast"],
            },
            dead_zones: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  start_sec: { type: "number" },
                  end_sec: { type: "number" },
                  reason: { type: "string" },
                },
                required: ["start_sec", "end_sec", "reason"],
              },
            },
          },
          required: [
            "cuts_per_sec",
            "total_cuts",
            "longest_scene_sec",
            "shortest_scene_sec",
            "scene_timeline",
            "pacing_rating",
            "dead_zones",
          ],
        },
        audio: {
          type: "object",
          properties: {
            has_voice: { type: "boolean" },
            has_music: { type: "boolean" },
            bpm_estimated: { type: ["number", "null"] },
            bpm_confidence: { type: "string", enum: ["low", "medium", "high"] },
            cuts_on_beat_pct: { type: ["number", "null"] },
            mood: { type: "string" },
            transcript: { type: ["string", "null"] },
            sync_with_visuals: { type: "number" },
            issues: { type: "array", items: { type: "string" } },
          },
          required: [
            "has_voice",
            "has_music",
            "bpm_estimated",
            "bpm_confidence",
            "cuts_on_beat_pct",
            "mood",
            "transcript",
            "sync_with_visuals",
            "issues",
          ],
        },
        visual: {
          type: "object",
          properties: {
            color_palette: { type: "array", items: { type: "string" } },
            lighting: {
              type: "string",
              enum: ["natural", "studio", "low_light", "mixed"],
            },
            primary_shot_types: { type: "array", items: { type: "string" } },
            visual_quality: { type: "number" },
            issues: { type: "array", items: { type: "string" } },
          },
          required: [
            "color_palette",
            "lighting",
            "primary_shot_types",
            "visual_quality",
            "issues",
          ],
        },
        text_overlays: {
          type: "array",
          items: {
            type: "object",
            properties: {
              text: { type: "string" },
              appears_at_sec: { type: "number" },
              duration_sec: { type: "number" },
              legibility: { type: "number" },
            },
            required: ["text", "appears_at_sec", "duration_sec", "legibility"],
          },
        },
        cta: {
          type: "object",
          properties: {
            present: { type: "boolean" },
            type: { type: ["string", "null"] },
            timing_sec: { type: ["number", "null"] },
            strength: { type: "number" },
            issue: { type: "string" },
            suggestion: { type: ["string", "null"] },
          },
          required: ["present", "type", "timing_sec", "strength", "issue", "suggestion"],
        },
        retention_estimate: {
          type: "object",
          properties: {
            curve: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sec: { type: "number" },
                  retention_pct: { type: "number" },
                },
                required: ["sec", "retention_pct"],
              },
            },
            drop_points: {
              type: "array",
              items: {
                type: "object",
                properties: {
                  sec: { type: "number" },
                  reason: { type: "string" },
                  severity: {
                    type: "string",
                    enum: ["minor", "moderate", "severe"],
                  },
                },
                required: ["sec", "reason", "severity"],
              },
            },
            overall_score: { type: "number" },
          },
          required: ["curve", "drop_points", "overall_score"],
        },
        vibe: {
          type: "object",
          properties: {
            primary: { type: "string" },
            secondary: { type: "array", items: { type: "string" } },
            target_audience: { type: "string" },
          },
          required: ["primary", "secondary", "target_audience"],
        },
        recommended_thumbnail: {
          type: "object",
          properties: {
            frame_sec: { type: "number" },
            reason: { type: "string" },
          },
          required: ["frame_sec", "reason"],
        },
        dimensions: {
          type: "object",
          properties: {
            voice_impact: dimensionSchema(),
            visual_pull: dimensionSchema(),
            emotional_hit: dimensionSchema(),
            cognitive_grip: sequenceDimensionSchema(),
            memorability: sequenceDimensionSchema(),
          },
          required: [
            "voice_impact",
            "visual_pull",
            "emotional_hit",
            "cognitive_grip",
            "memorability",
          ],
        },
        engagement: {
          type: "object",
          properties: {
            timeline: timelineArraySchema(),
            moments: momentsArraySchema(),
          },
          required: ["timeline", "moments"],
        },
        overall: {
          type: "object",
          properties: {
            score: { type: "number" },
            verdict: { type: "string" },
            weaknesses: { type: "array", items: { type: "string" } },
            top_3_actions: {
              type: "array",
              items: { type: "string" },
              minItems: 3,
              maxItems: 3,
            },
          },
          required: ["score", "verdict", "weaknesses", "top_3_actions"],
        },
      },
      required: [
        "hook",
        "pacing",
        "audio",
        "visual",
        "text_overlays",
        "cta",
        "retention_estimate",
        "vibe",
        "recommended_thumbnail",
        "dimensions",
        "engagement",
        "overall",
      ],
    },
  };
}

function timelineArraySchema() {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        sec: { type: "number" },
        value: { type: "number" },
      },
      required: ["sec", "value"],
    },
  } as const;
}

function momentsArraySchema() {
  return {
    type: "array",
    items: {
      type: "object",
      properties: {
        sec: { type: "number" },
        value: { type: "number" },
        type: { type: "string", enum: ["peak", "dip"] },
        reason: { type: "string" },
      },
      required: ["sec", "value", "type", "reason"],
    },
  } as const;
}

function dimensionSchema() {
  return {
    type: "object",
    properties: {
      score: { type: "number" },
      timeline: timelineArraySchema(),
      moments: momentsArraySchema(),
      summary: { type: "string" },
    },
    required: ["score", "timeline", "moments", "summary"],
  } as const;
}

function sequenceDimensionSchema() {
  return {
    type: "object",
    properties: {
      score: { type: "number" },
      summary: { type: "string" },
    },
    required: ["score", "summary"],
  } as const;
}

export type ClaudeAnalysisInput = {
  meta: VideoMeta;
  frames: { base64: string; approx_sec: number; zone: FrameZone }[];
  sceneCuts: SceneCut[];
  transcript: string;
  motion: SecondMetric[];
  loudness: SecondMetric[];
  loudnessFine: SecondMetric[];
  cutDensity: SecondMetric[];
  niche: NicheDetection;
  intake?: {
    inferred: {
      summary: string;
      language: string;
      format_guess: string;
      audience_guess: string;
      confidence: "low" | "medium" | "high";
    };
    answers: Record<string, string>;
  };
};

function compactMetrics(
  motion: SecondMetric[],
  loudness: SecondMetric[],
  cutDensity: SecondMetric[],
): string {
  const motionMap = new Map(motion.map((m) => [Math.floor(m.sec), m.value]));
  const loudMap = new Map(loudness.map((m) => [Math.floor(m.sec), m.value]));
  const cutMap = new Map(cutDensity.map((m) => [m.sec, m.value]));
  const maxSec = Math.max(
    ...motion.map((m) => m.sec),
    ...loudness.map((m) => m.sec),
    0,
  );
  const rows: string[] = ["sec | motion | loudness_dB | cuts_in_5s_window"];
  for (let s = 0; s <= Math.floor(maxSec); s++) {
    const m = motionMap.get(s);
    const l = loudMap.get(s);
    const c = cutMap.get(Math.floor(s / 5) * 5) ?? 0;
    rows.push(
      `${String(s).padStart(3)} | ${m != null ? m.toFixed(1).padStart(6) : "  n/a"} | ${l != null ? l.toFixed(1).padStart(11) : "      n/a"} | ${c}`,
    );
  }
  return rows.join("\n");
}

function compactFineLoudness(loudnessFine: SecondMetric[]): string {
  if (loudnessFine.length === 0) return "(no fine-grained loudness available)";
  const samples = loudnessFine.map(
    (s) => `${s.sec.toFixed(2)}s=${s.value.toFixed(1)}dB`,
  );
  return samples.join(", ");
}

export async function analyzeWithClaude(
  input: ClaudeAnalysisInput,
): Promise<AnalysisResult> {
  const frameBlocks = input.frames.map((f) => ({
    type: "image" as const,
    source: {
      type: "base64" as const,
      media_type: "image/jpeg" as const,
      data: f.base64,
    },
  }));

  const intakeBlock = input.intake
    ? [
        `# Creator-provided intake (Haiku pre-analysis + creator answers)`,
        `Haiku's inferred reading: ${input.intake.inferred.summary}`,
        `Inferred language: ${input.intake.inferred.language}`,
        `Inferred format: ${input.intake.inferred.format_guess}`,
        `Inferred audience: ${input.intake.inferred.audience_guess}`,
        `Confidence: ${input.intake.inferred.confidence}`,
        ``,
        `Creator's answers (THESE TAKE PRECEDENCE over any default playbook rule — adjust scoring weights and verdict accordingly):`,
        ...Object.entries(input.intake.answers).map(
          ([k, v]) => `  - ${k}: ${v}`,
        ),
        ``,
        `Calibration rules driven by intake:`,
        `- If goal=entertain/vent: do NOT penalize lack of CTA. Score 'cta.strength' as N/A or relative to entertainment value, not commercial. Verdict tone shifts from 'will it convert' to 'will it land'.`,
        `- If goal=grow/sell: keep commercial calibration. CTA matters.`,
        `- If metric=completion: weight retention and pacing heavier.`,
        `- If metric=shares: weight emotional_hit, memorability, and punchline strength heavier. Allow longer duration if shareability stays high.`,
        `- If metric=saves: weight cognitive_grip and "rewatchable value" heavier.`,
        `- If series: hook can rely on prior episodes; don't penalize cold-open absence as harshly.`,
        `- If craft notes mention 'long take' / 'no edits' / 'freestyle' / 'rime' / 'dialect': RESPECT these. Do not flag them as dead zones or production failures.`,
        ``,
      ].join("\n")
    : "";

  const factsText = [
    intakeBlock,
    `# Niche classification`,
    `- niche: ${input.niche.niche} (confidence ${input.niche.confidence}/100)`,
    `- reasoning: ${input.niche.reasoning}`,
    ``,
    `# Niche playbook (apply these rules — they override generic advice)`,
    nichePlaybook(input.niche.niche),
    ``,
    `# Video metadata`,
    `- duration: ${input.meta.duration_sec.toFixed(2)}s`,
    `- dimensions: ${input.meta.width}x${input.meta.height}`,
    `- aspect ratio: ${input.meta.aspect_ratio}`,
    `- fps: ${input.meta.fps}`,
    `- file size: ${input.meta.file_size_mb}MB`,
    ``,
    `# Scene cuts (seconds)`,
    input.sceneCuts.length === 0
      ? "(no hard cuts detected — likely single-take)"
      : input.sceneCuts.map((c) => c.time_sec.toFixed(2)).join(", "),
    ``,
    `# Per-second metrics`,
    "```",
    compactMetrics(input.motion, input.loudness, input.cutDensity),
    "```",
    ``,
    `# Fine-grained loudness (4Hz, first 30s — use for BPM estimation)`,
    compactFineLoudness(input.loudnessFine),
    ``,
    `# Audio transcript`,
    input.transcript
      ? input.transcript
      : "(no transcript — voice may still be present; check loudness for evidence)",
    ``,
    `# Frames (chronological)`,
    input.frames
      .map(
        (f, i) =>
          `  #${i + 1} t=${f.approx_sec.toFixed(2)}s [${f.zone.toUpperCase()}]`,
      )
      .join("\n"),
  ].join("\n");

  const tools = [toolSchema()];

  const response = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 20000,
    thinking: { type: "enabled", budget_tokens: 10000 },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools,
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [{ type: "text", text: factsText }, ...frameBlocks],
      },
    ],
  });

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
  );
  if (!toolUse) throw new Error("Claude did not return tool_use");
  const partial = sanitizeToolInput(
    toolUse.input as Record<string, unknown>,
  ) as Omit<AnalysisResult, "meta" | "niche">;
  return { meta: input.meta, niche: input.niche, ...partial };
}

function sanitizeToolInput(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) {
    if (
      typeof v === "string" &&
      (v.trim().startsWith("{") || v.trim().startsWith("["))
    ) {
      try {
        out[k] = JSON.parse(v);
        continue;
      } catch {}
    }
    out[k] = v;
  }
  return out;
}

const CRITIQUE_PROMPT = `You just produced an analysis of a reel. Now critique YOUR OWN analysis and replace it with a SHARPER version.

Your job is to find weaknesses in your previous analysis and rewrite the entire result.

**Look for and replace:**
- Vague statements ("could be better") → replace with specific metric-based criticism
- Generic SoMe advice → replace with niche-specific, citing the playbook rules
- Soft criticism → harden it; this creator is shipping garbage and needs to know
- Missing weaknesses → add anything you missed
- Drop_points that lack specific metric citations → cite motion/loudness values
- Top_3_actions that are not concrete edits → rewrite as specific timecode-based edits
- Hook variations that are weak/generic → replace with sharper alternatives
- If verdict is soft, sharpen it. One brutal sentence.

DO NOT add strengths. DO NOT soften tone. Only add weaknesses, never remove them. The harder the better.

Output the FULL improved analysis via the analyze_reel tool. Same schema, sharper content.`;

export async function selfCritique(
  prev: AnalysisResult,
  input: ClaudeAnalysisInput,
): Promise<AnalysisResult> {
  const tools = [toolSchema()];
  const prevJson = JSON.stringify(
    { ...prev, meta: undefined, niche: undefined },
    null,
    2,
  );

  const factsText = [
    `# Niche`,
    `${input.niche.niche} — ${nichePlaybook(input.niche.niche)}`,
    ``,
    `# Previous analysis (your own — critique and replace)`,
    "```json",
    prevJson,
    "```",
    ``,
    `# Per-second metrics (re-reference for sharper grounding)`,
    "```",
    compactMetrics(input.motion, input.loudness, input.cutDensity),
    "```",
  ].join("\n");

  const response = await client().messages.create({
    model: "claude-sonnet-4-6",
    max_tokens: 24000,
    thinking: { type: "enabled", budget_tokens: 4000 },
    system: [
      {
        type: "text",
        text: SYSTEM_PROMPT + "\n\n" + CRITIQUE_PROMPT,
        cache_control: { type: "ephemeral" },
      },
    ],
    tools,
    tool_choice: { type: "auto" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text: factsText },
          ...input.frames.slice(0, 4).map((f) => ({
            type: "image" as const,
            source: {
              type: "base64" as const,
              media_type: "image/jpeg" as const,
              data: f.base64,
            },
          })),
        ],
      },
    ],
  });

  const toolUse = response.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
  );
  if (!toolUse) {
    console.warn("self-critique returned no tool use, keeping original");
    return prev;
  }
  const partial = sanitizeToolInput(
    toolUse.input as Record<string, unknown>,
  ) as Omit<AnalysisResult, "meta" | "niche">;
  if (!partial.overall || typeof partial.overall !== "object") {
    console.warn("self-critique returned malformed overall, keeping original");
    return prev;
  }
  return { meta: input.meta, niche: input.niche, ...partial };
}
