// ── POST /api/kits/[id]/suggest-fonts ──────────────────────────────────────
// Uses Claude to pick a best-fit heading + body Google Fonts pairing based on
// the kit's brand inputs (name, industry, voice keywords, tagline, vibe).
// Returns { heading, body, rationale } where both are real Google Fonts
// family names. Caller persists into press_kits.fonts.

import type { APIRoute } from "astro";
import Anthropic from "@anthropic-ai/sdk";
import { createAdminClient } from "../../../../lib/supabase";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { json } from "../../../../lib/api-utils";
import GOOGLE_FONTS_ALL from "../../../../lib/google-fonts-all.json";

const ALLOWED = new Set<string>(GOOGLE_FONTS_ALL.map((f) => f.family));

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  if (!checkRateLimit(`kits-fontsai:${user.id}`, 6, 60_000)) {
    return json({ error: "Slow down." }, 429);
  }

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, name, tagline, industry, voice_keywords, voice_paragraph, kit_type")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);

  const apiKey =
    process.env.ANTHROPIC_API_KEY ?? (import.meta as any).env?.ANTHROPIC_API_KEY;
  if (!apiKey) return json({ error: "ANTHROPIC_API_KEY not configured" }, 500);

  const anthropic = new Anthropic({ apiKey });

  const brief = [
    `Brand name: ${kit.name}`,
    kit.tagline ? `Tagline: ${kit.tagline}` : null,
    kit.industry ? `Industry: ${kit.industry}` : `Industry type: ${kit.kit_type ?? "other"}`,
    kit.voice_keywords ? `Voice keywords: ${kit.voice_keywords}` : null,
    kit.voice_paragraph ? `Voice paragraph: ${kit.voice_paragraph}` : null,
  ].filter(Boolean).join("\n");

  const sys = `You are a senior brand-book typographer. Pick TWO Google Fonts that pair beautifully for the brand. Output JSON only, with shape { "heading": string, "body": string, "rationale": string (one short sentence) }.

Rules:
- Use ONLY real Google Fonts family names. Use exact spelling.
- Heading is for display titles. Body must be supremely readable at small sizes (12-18px).
- Pair must contrast: never the same family for both. Never two near-identical sans-serifs.
- Match the brand vibe: editorial → serif heading + clean sans body; tech/SaaS → geometric sans + humanist sans; playful F&B → rounded display + soft sans; luxury → high-contrast serif + transitional/grotesque body; brutalist → condensed industrial + neutral sans.
- Prefer well-loaded fonts that look professional (Inter, Manrope, Playfair Display, Fraunces, Instrument Serif, Instrument Sans, Cormorant, EB Garamond, DM Sans, Plus Jakarta Sans, Space Grotesk, Geist, Bricolage Grotesque, Funnel Display, Funnel Sans, Anton, Oswald, Archivo, Bodoni Moda, Italiana, Spectral, Lora, Crimson Pro, Newsreader, Karla, Public Sans, Outfit, Sora, etc.). Avoid weird display fonts unless the brief screams for it.
- Output JSON ONLY, no prose, no markdown fences.`;

  let suggestion: { heading?: string; body?: string; rationale?: string } = {};
  try {
    const res = await anthropic.messages.create({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 200,
      system: sys,
      messages: [{ role: "user", content: brief }],
    });
    const text = res.content[0]?.type === "text" ? res.content[0].text : "";
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart >= 0 && jsonEnd > jsonStart) {
      suggestion = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
    }
  } catch (e) {
    console.error("[suggest-fonts] Claude failed:", e);
  }

  // Validate against the real Google Fonts catalog. Fall back to a safe pair
  // for the kit's industry if Claude returned something invalid.
  const heading = suggestion.heading && ALLOWED.has(suggestion.heading) ? suggestion.heading : safeHeading(kit.kit_type);
  const body    = suggestion.body    && ALLOWED.has(suggestion.body)    ? suggestion.body    : safeBody(kit.kit_type);
  const rationale = suggestion.rationale ?? "Auto-paired for your brand vibe.";

  // Persist immediately so refresh doesn't lose it.
  const fonts = { heading, body, auto: true };
  await client.from("press_kits").update({ fonts }).eq("id", params.id);

  return json({ heading, body, rationale });
};

function safeHeading(kitType: string | null): string {
  switch (kitType) {
    case "musician":     return "Anton";
    case "photographer": return "Playfair Display";
    case "agency":       return "Space Grotesk";
    case "founder":      return "Instrument Serif";
    case "model":        return "Italiana";
    default:             return "Manrope";
  }
}
function safeBody(kitType: string | null): string {
  switch (kitType) {
    case "musician":     return "Inter";
    case "photographer": return "Inter";
    case "agency":       return "Inter";
    case "founder":      return "Inter";
    case "model":        return "Public Sans";
    default:             return "Inter";
  }
}
