import Anthropic from "@anthropic-ai/sdk";
import type { Tool } from "@anthropic-ai/sdk/resources/messages";
import type { IntakeContext, NicheDetection } from "./types";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

const TOOL: Tool = {
  name: "submit_intake",
  description:
    "Submit a short intake: your inferred reading of the video and 2-4 gap-filling questions for the creator.",
  input_schema: {
    type: "object",
    properties: {
      inferred: {
        type: "object",
        properties: {
          summary: {
            type: "string",
            description:
              "One sentence summarizing what you understand the reel to be — format, tone, language, performer. Use the creator's language.",
          },
          language: {
            type: "string",
            description: "ISO-like code or label: 'ro', 'en', 'es', 'mixed'",
          },
          format_guess: {
            type: "string",
            description:
              "Best guess at the format: skit / talking head / DJ set / tutorial / vlog / dance / etc.",
          },
          audience_guess: {
            type: "string",
            description:
              "Best guess at who the reel is aimed at. Keep short.",
          },
          confidence: {
            type: "string",
            enum: ["low", "medium", "high"],
          },
        },
        required: [
          "summary",
          "language",
          "format_guess",
          "audience_guess",
          "confidence",
        ],
      },
      questions: {
        type: "array",
        minItems: 2,
        maxItems: 4,
        items: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description:
                "Short snake_case key, e.g. 'goal', 'audience', 'metric', 'series'",
            },
            label: {
              type: "string",
              description:
                "The question text in the creator's language. Be concrete and short.",
            },
            helper: {
              type: "string",
              description:
                "Optional one-line context for why we're asking. Keep it under 12 words.",
            },
            type: { type: "string", enum: ["chip", "text"] },
            options: {
              type: "array",
              description:
                "Required for type=chip. 3-5 short options the creator can tap.",
              items: {
                type: "object",
                properties: {
                  value: { type: "string" },
                  label: { type: "string" },
                },
                required: ["value", "label"],
              },
            },
            inferred_default: {
              type: "string",
              description:
                "Optional preselect value matching one of the options or a draft text answer. Use only when confidence is high.",
            },
          },
          required: ["id", "label", "type"],
        },
      },
    },
    required: ["inferred", "questions"],
  },
};

const SYSTEM = `You are a short-form video intake agent. You see the first frames + transcript of a reel BEFORE the deep analysis pass.

Your job: tell the creator what you've inferred, then ask the smallest number of questions needed to fill gaps that would otherwise force the analyzer to guess.

Rules:
- 2 questions if you're confident, 3-4 if context is thin. Never more than 4.
- Do NOT re-ask things you can already infer from frames or transcript (language, niche, performer count, mood).
- Each question must be a real decision point — if any plausible answer would change the analysis recipe, ask. If not, don't.
- Prefer "chip" type with 3-5 short options over open text. Use "text" only for genuinely open follow-ups.
- Use the creator's language (Romanian → Romanian, etc.).
- Be warm and concise. No marketing fluff. No "as an AI…" boilerplate.
- ALWAYS call the submit_intake tool. Never reply in prose.

Good questions cover (pick whatever matters most):
- intent / goal: entertain / grow / sell / educate / vent / archive
- target metric: completion / shares / comments / saves / views
- standalone or part of series
- deliberate craft choices to respect (long take, freestyle, no edits, dialect, irony)
- distribution: organic feed / paid / cross-post / niche community

Avoid:
- "What's your name", "What's your handle" — useless for analysis.
- "What's your budget" — irrelevant.
- Generic survey filler.`;

export async function generateIntake(input: {
  durationSec: number;
  aspectRatio: string;
  transcript: string;
  hookFrames: { base64: string; sec: number }[];
  niche: NicheDetection;
}): Promise<IntakeContext> {
  const text = [
    `Reel intake — propose what you've inferred + the smallest set of questions.`,
    ``,
    `Duration: ${input.durationSec.toFixed(1)}s`,
    `Aspect ratio: ${input.aspectRatio}`,
    `Detected niche: ${input.niche.niche} (confidence ${input.niche.confidence})`,
    `Niche reasoning: ${input.niche.reasoning}`,
    ``,
    `Transcript:`,
    input.transcript || "(none / silent / music-only)",
    ``,
    `${input.hookFrames.length} hook frames (0-3s) follow.`,
  ].join("\n");

  const res = await client().messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 1500,
    system: SYSTEM,
    tools: [TOOL],
    tool_choice: { type: "tool", name: "submit_intake" },
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

  const block = res.content.find(
    (c) => c.type === "tool_use" && c.name === "submit_intake",
  );
  if (!block || block.type !== "tool_use") {
    throw new Error("intake: no tool_use in response");
  }
  return block.input as IntakeContext;
}
