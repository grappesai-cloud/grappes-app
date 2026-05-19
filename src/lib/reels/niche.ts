import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { Niche, NicheDetection } from "./types";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const NICHES: Niche[] = [
  "comedy_skit",
  "dj_set",
  "music_performance",
  "fitness_motivation",
  "fitness_tutorial",
  "food_recipe",
  "food_review",
  "educational",
  "vlog_lifestyle",
  "product_demo",
  "transformation",
  "dance_choreo",
  "fashion_outfit",
  "thirst_trap",
  "talking_head",
  "tech_demo",
  "asmr",
  "travel",
  "other",
];

const TOOL: Tool = {
  name: "classify_niche",
  description: "Classify the reel into a single niche.",
  input_schema: {
    type: "object",
    properties: {
      niche: { type: "string", enum: NICHES as unknown as string[] },
      confidence: { type: "number" },
      reasoning: { type: "string" },
    },
    required: ["niche", "confidence", "reasoning"],
  },
};

export async function detectNiche(input: {
  durationSec: number;
  aspectRatio: string;
  transcript: string;
  hookFrames: { base64: string; sec: number }[];
}): Promise<NicheDetection> {
  const text = [
    `Classify this short-form video into ONE niche from the schema.`,
    ``,
    `Duration: ${input.durationSec.toFixed(1)}s`,
    `Aspect ratio: ${input.aspectRatio}`,
    `Transcript: ${input.transcript || "(none / silent / music-only)"}`,
    ``,
    `${input.hookFrames.length} hook frames (0-3s) follow. Confidence 0-100.`,
  ].join("\n");

  const res = await client().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: "You classify short-form videos into exactly one niche. Use the tool.",
    tools: [TOOL],
    tool_choice: { type: "tool", name: "classify_niche" },
    messages: [
      {
        role: "user",
        content: [
          { type: "text", text },
          ...input.hookFrames.map((f) => ({
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

  const tu = res.content.find(
    (c): c is Anthropic.ToolUseBlock => c.type === "tool_use",
  );
  if (!tu) {
    return {
      niche: "other",
      confidence: 0,
      reasoning: "Haiku failed to classify",
    };
  }
  return tu.input as NicheDetection;
}

const NICHE_PLAYBOOK: Record<Niche, string> = {
  comedy_skit: `COMEDY SKIT playbook (be ruthless):
- Retention killers: punchline too late, weak first frame, no relatable hook line, dead time between gags
- Format truths: viral comedy skits average 15-30s. >45s is a death sentence unless density is exceptional.
- Hook must be either: a question ("Când eu...?"), a relatable cringe moment, or visual shock in 0-1s
- CTA must be in-character or tag-a-friend (NEVER "follow for more" — comedy audiences hate corporate CTAs)
- Music: optional, but if present must NOT step on dialogue. Subtitle absence kills 60% of mute viewers`,

  dj_set: `DJ SET playbook (be ruthless):
- Retention killers: track build-up too slow, no drop in first 10s, blurry hands, no crowd reaction
- Format truths: viral DJ clips are 15-30s of pure peak energy. The hook IS the drop.
- Hook must show: drop moment OR crowd losing it OR unusual gear/setup in 0-1.5s
- CTA: track ID in comments, set date/venue overlay, or "next gig" link in bio
- BPM/beat-sync is non-negotiable for DJ content. Cuts off-beat = unfollow signal`,

  music_performance: `MUSIC PERFORMANCE playbook:
- Retention killers: bad audio quality, no on-screen lyrics, weak first vocal moment
- Hook: best vocal line in 0-3s, or visual moment of intensity
- Format: 30-60s acceptable if the song carries. Beyond 60s only if performance is exceptional
- CTA: streaming link, song title overlay, "full version on..." pattern`,

  fitness_motivation: `FITNESS MOTIVATION playbook:
- Retention killers: setup montage too long, no payoff visible in 0-5s, generic gym shots
- Hook: peak rep, weight number visible, or transformation tease in 0-2s
- Format: 15-45s. Motivational reels rarely justify >45s
- CTA: "follow for daily lifts" or workout-of-the-day style`,

  fitness_tutorial: `FITNESS TUTORIAL playbook:
- Retention killers: no clear "before" state, exercise form unclear, no text overlays for sets/reps
- Hook: exercise name overlay + target muscle in 0-2s
- Format: 30-60s. Tutorials need air to demonstrate
- CTA: save for later, follow for X-day program`,

  food_recipe: `FOOD RECIPE playbook:
- Retention killers: ingredients listed too long, final dish not shown in first 3s, no ASMR
- Hook: final plated dish or sizzle moment in 0-2s (always show the result first)
- Format: 30-60s, viral recipes are tight
- CTA: "save it", "recipe in comments", or trending audio mention`,

  food_review: `FOOD REVIEW playbook:
- Retention killers: setup before the bite, weak first reaction, no money-shot of food
- Hook: bite + reaction face in 0-2s
- Format: 15-30s
- CTA: "is it worth it?" question, location tag`,

  educational: `EDUCATIONAL playbook (be ruthless):
- Retention killers: "in this video I'll explain..." intro, no payoff promise, text-heavy first 3s
- Hook: surprising claim or counter-intuitive fact in 0-2s
- Format: 30-60s, max 90s if truly dense
- CTA: "follow for daily X" or "part 2 dropping..."`,

  vlog_lifestyle: `VLOG LIFESTYLE playbook:
- Retention killers: slow setup, no clear narrative arc, generic b-roll
- Hook: peak moment of the day in 0-2s, then rewind
- Format: 30-60s. Beyond that needs voice-over discipline
- CTA: "follow my day", "ep 2 tomorrow"`,

  product_demo: `PRODUCT DEMO playbook:
- Retention killers: brand logo first, slow unboxing, no problem-statement
- Hook: problem the product solves shown in 0-2s, NOT the product itself
- Format: 15-30s. Demos that go long feel like ads
- CTA: link in bio, code in description`,

  transformation: `TRANSFORMATION playbook:
- Retention killers: before-state too long, transformation reveal too late, no contrast
- Hook: after-state teased in 0-2s, then return to before
- Format: 15-30s
- CTA: "how I did it" → save/follow`,

  dance_choreo: `DANCE CHOREO playbook:
- Retention killers: setup before first move, off-beat cuts, low-energy first 2 counts
- Hook: hardest move teaser or full-body in 0-1s
- Format: 15-30s, matches song length
- CTA: "try this", song credit`,

  fashion_outfit: `FASHION/OUTFIT playbook:
- Retention killers: face only first, no full-body in 0-3s, no transformation
- Hook: outfit reveal or transformation moment in 0-2s
- Format: 10-20s. Long outfit reels die.
- CTA: outfit details in comments, brand tags`,

  thirst_trap: `THIRST TRAP playbook (be ruthless):
- Retention killers: face only no body, too clothed in hook, no movement, lyric-mismatch with vibe
- Hook: full-body or face+body in 0-1s, lip-sync ON the beat
- Format: 8-15s. Long thirst traps don't exist.
- CTA: usually none — engagement is the goal`,

  talking_head: `TALKING HEAD playbook (be ruthless):
- Retention killers: "hey guys", weak first sentence, no b-roll, no captions
- Hook: first sentence must be a hook ("Most people don't know that..."). NEVER greeting.
- Format: 20-45s. Beyond that needs cutaways.
- CTA: "part 2", "comment X for...", or "save for later"`,

  tech_demo: `TECH DEMO playbook:
- Retention killers: explanation before demo, UI too small, no human reaction
- Hook: end-state or "magic moment" in 0-2s
- Format: 20-45s
- CTA: link, code in bio, app name visible`,

  asmr: `ASMR playbook:
- Retention killers: weak audio first, talking, environmental noise
- Hook: trigger sound + close-up in 0-2s
- Format: 30-60s. ASMR loops are forgiven for longer durations.
- CTA: usually none, or "save for sleep"`,

  travel: `TRAVEL playbook:
- Retention killers: airport/airplane shots, slow build, no destination reveal
- Hook: most stunning destination shot in 0-2s
- Format: 20-45s
- CTA: location tag, "trip itinerary in comments"`,

  other: `Generic short-form playbook:
- Retention killers: slow hook, no clear payoff promise, weak first frame
- Hook: most visually striking or surprising moment in 0-2s
- Format: 15-45s typical sweet spot
- CTA: always have one — follow, save, comment, or link`,
};

export function nichePlaybook(niche: Niche): string {
  return NICHE_PLAYBOOK[niche] ?? NICHE_PLAYBOOK.other;
}
