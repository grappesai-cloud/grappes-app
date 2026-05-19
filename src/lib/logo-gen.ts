// ── AI Logo Generator pipeline (Recraft V4 Vector) ─────────────────────────
// Engine: Recraft external API at https://external.api.recraft.ai/v1.
// Flow:
//   1. If referenceImages are present, POST them as multipart/form-data to
//      /v1/styles with style="vector_illustration" to obtain a style_id.
//      Style transfer requires the V3 vector model (V4 does not yet support
//      style_id), so we route those generations through `recraftv3_vector`.
//   2. POST to /v1/images/generations:
//        - default model: `recraftv4_vector` (Recraft V4 Vector, native SVG)
//        - with refs:     `recraftv3_vector` + style_id + style="vector_illustration"
//      response_format=url (default), so we fetch the SVG bytes back.
//   3. Render a PNG companion from the SVG via sharp (native SVG input).
//   4. Both files go to Vercel Blob under kits/<id>/logo-<ts>.{svg,png}.
//
// Confirmed against Recraft's official docs (2026-02 release):
//   https://www.recraft.ai/docs/api-reference/endpoints.md
//   https://www.recraft.ai/docs/recraft-models/recraft-V4.md
//
// Caller persists pngUrl + svgUrl to kit.assets.logo / kit.assets.logo_svg.

import sharp from "sharp";
import { put } from "@vercel/blob";

// Premium accent palette — used when caller doesn't pass primaryColor.
// One is picked at random per generation so successive logos for the same
// brand differ visually (caller is free to regenerate).
const ACCENT_PALETTE: { name: string; hex: string }[] = [
  { name: "deep emerald",       hex: "#0f5132" },
  { name: "oxblood",            hex: "#6b1d1d" },
  { name: "electric ultramarine", hex: "#1d2bd1" },
  { name: "cadmium orange",     hex: "#e25822" },
  { name: "warm graphite",      hex: "#2a2a2a" },
  { name: "ivory",              hex: "#f5efe0" },
  { name: "cobalt",             hex: "#1e3a8a" },
  { name: "terracotta",         hex: "#b65238" },
  { name: "olive",              hex: "#5a6b2f" },
  { name: "midnight",           hex: "#0b1f3a" },
  { name: "blush",              hex: "#c97064" },
  { name: "sage",               hex: "#7a8b6f" },
];

function pickAccent(): { name: string; hex: string } {
  return ACCENT_PALETTE[Math.floor(Math.random() * ACCENT_PALETTE.length)];
}

const BASE_RULES = [
  "flat vector style, single or two-tone solid color silhouette",
  "soft off-white #FAFAFA background — no harsh pure white",
  "NO gradients, NO drop shadows, NO inner shadows, NO outer glow, NO bevels, NO 3D",
  "NO photorealism, NO photographs, NO textures, NO noise",
  "thick clean shapes, recognizable at 32px favicon scale",
  "high contrast against the background — large solid shapes",
  "negative space allowed",
];
const ICON_ONLY_RULES = [
  ...BASE_RULES,
  "NO text, NO letters, NO numbers, NO wordmark — icon mark only",
];
const WORDMARK_RULES = [
  ...BASE_RULES,
  "wordmark / lettermark — the brand name is the logo, set in a strong custom-style letterform",
  "letters must be SHARP and READABLE, not decorative noise",
];
const COMBO_RULES = [
  ...BASE_RULES,
  "combination mark — an icon + the brand name set together with strong hierarchy",
  "the icon and the wordmark should feel like one mark, not two unrelated shapes",
];
type LogoType = "icon" | "wordmark" | "combination";
function rulesFor(t: LogoType): string {
  if (t === "wordmark") return WORDMARK_RULES.join("; ");
  if (t === "combination") return COMBO_RULES.join("; ");
  return ICON_ONLY_RULES.join("; ");
}

export interface GeneratedLogo {
  pngUrl: string;
  svgUrl: string;
  pngBytes: number;
  svgBytes: number;
}

export interface GenerateLogoInput {
  kitId: string;
  description: string;
  primaryColor?: string;
  paletteColors?: string[];
  style?: string;
  referenceImages?: string[];
  brandName?: string;
  logoType?: "icon" | "wordmark" | "combination";
  mood?: string;
}

const RECRAFT_BASE = "https://external.api.recraft.ai/v1";

function recraftApiKey(): string {
  const k =
    process.env.RECRAFT_API_KEY ??
    (import.meta as any).env?.RECRAFT_API_KEY;
  if (!k) throw new Error("RECRAFT_API_KEY not configured");
  return k;
}

/**
 * Build the textual prompt — reuses the same logoType + brand-name logic that
 * the previous OpenAI implementation used. Recraft V4 respects design briefs
 * much better than gpt-image-1, but we still ship the literal rules so the
 * user's description always lands in the output.
 */
function buildPrompt(input: GenerateLogoInput): string {
  let colorHint: string;
  if (input.paletteColors && input.paletteColors.length > 0) {
    const cs = input.paletteColors.slice(0, 3).join(", ");
    colorHint = `Use the brand's existing palette for the mark's fill: ${cs}. Prefer ONE of these as the dominant color (pick the boldest, most saturated one).`;
  } else if (input.primaryColor) {
    colorHint = `Use this color as the mark's solid fill: ${input.primaryColor}.`;
  } else {
    const accent = pickAccent();
    colorHint = `Use a single bold accent color for the mark: ${accent.name} (${accent.hex}). NEVER default to black. NEVER use grey.`;
  }
  const styleHint = input.style ? `Style: ${input.style}.` : "";

  const logoType: LogoType = input.logoType ?? "icon";
  const brand = input.brandName?.trim();
  const moodHint = input.mood ? `Mood: ${input.mood}.` : "";

  const typeIntro = (() => {
    if (logoType === "wordmark") {
      return `Design a WORDMARK logo for the brand "${brand ?? input.description}". The brand name "${brand ?? ""}" must appear as readable text in a strong, custom-feeling letterform. ${input.description ? `Additional brief: ${input.description}.` : ""}`;
    }
    if (logoType === "combination") {
      return `Design a COMBINATION mark for the brand "${brand ?? input.description}" — an icon paired with the readable brand name "${brand ?? ""}". The icon and the wordmark should sit together as one mark. ${input.description ? `Concept: ${input.description}.` : ""}`;
    }
    return `Design an ICON-ONLY logo mark (no text) for: "${input.description}"${brand ? ` (brand: "${brand}")` : ""}.`;
  })();

  return `${typeIntro}
${colorHint}
${styleHint}
${moodHint}
STRICT VISUAL RULES: ${rulesFor(logoType)}.
The result will be delivered as a native vector SVG, so keep it as a clean silhouette with strong contrast against the off-white background.
Take the user's description literally — if they asked for a specific element, motif, or concept, it MUST appear in the output. Do not substitute it with something generic.`;
}

/**
 * Upload reference images to Recraft's /v1/styles endpoint as a custom
 * "vector_illustration" style. Returns the style UUID.
 *
 * Note: per Recraft docs, style_id is V2/V3 only — V4 does not yet support it.
 * Callers that pass references should use `recraftv3_vector` for generation.
 */
async function createReferenceStyle(referenceImages: string[]): Promise<string> {
  const apiKey = recraftApiKey();
  const refs = referenceImages.slice(0, 5);

  const form = new FormData();
  form.append("style", "vector_illustration");

  for (let i = 0; i < refs.length; i++) {
    const url = refs[i];
    const r = await fetch(url);
    if (!r.ok) throw new Error(`Failed to fetch reference image ${i + 1} (${url})`);
    const ct = r.headers.get("content-type") ?? "image/png";
    const ext = ct.includes("webp") ? "webp" : ct.includes("jpeg") || ct.includes("jpg") ? "jpg" : "png";
    const buf = Buffer.from(await r.arrayBuffer());
    // FormData (web) accepts Blob — Node 20+/Astro runtime polyfills this.
    const blob = new Blob([buf], { type: ct });
    form.append(`file${i + 1}`, blob, `ref-${i + 1}.${ext}`);
  }

  const res = await fetch(`${RECRAFT_BASE}/styles`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}` },
    body: form as any,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recraft /styles failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { id?: string };
  if (!json.id) throw new Error("Recraft /styles returned no id");
  return json.id;
}

/**
 * Call Recraft's /v1/images/generations endpoint and return the generated SVG
 * as a UTF-8 string + raw bytes.
 *
 * Model choice:
 *  - With references → `recraftv3_vector` + style_id (V4 has no style_id yet).
 *  - Without references → `recraftv4_vector` (newer model, sharper SVGs).
 */
async function generateSvgFromRecraft(input: GenerateLogoInput): Promise<{ svg: string; bytes: Buffer }> {
  const apiKey = recraftApiKey();
  const prompt = buildPrompt(input);
  const refs = (input.referenceImages ?? []).slice(0, 5);

  let styleId: string | undefined;
  if (refs.length > 0) {
    styleId = await createReferenceStyle(refs);
  }

  const body: Record<string, unknown> = {
    prompt,
    n: 1,
    response_format: "url",
    style: "vector_illustration",
  };
  if (styleId) {
    // Style transfer only available on V3 (per Recraft docs as of 2026-02).
    body.model = "recraftv3_vector";
    body.style_id = styleId;
  } else {
    body.model = "recraftv4_vector";
  }

  const res = await fetch(`${RECRAFT_BASE}/images/generations`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Recraft /images/generations failed: ${res.status} ${text}`);
  }
  const json = (await res.json()) as { data?: { url?: string; b64_json?: string }[] };
  const item = json.data?.[0];
  if (!item) throw new Error("Recraft returned no image data");

  let svgBytes: Buffer;
  if (item.url) {
    const r = await fetch(item.url);
    if (!r.ok) throw new Error(`Failed to fetch Recraft SVG (${r.status})`);
    svgBytes = Buffer.from(await r.arrayBuffer());
  } else if (item.b64_json) {
    svgBytes = Buffer.from(item.b64_json, "base64");
  } else {
    throw new Error("Recraft response missing url and b64_json");
  }

  // Recraft vector responses are SVG documents; verify quickly.
  const svg = svgBytes.toString("utf8");
  if (!svg.includes("<svg")) {
    throw new Error("Recraft response did not contain an SVG payload");
  }
  return { svg, bytes: svgBytes };
}

/**
 * Render a PNG companion from the generated SVG using sharp. sharp accepts
 * SVG input natively — we size the longest edge to 1024px on a transparent
 * background so the PNG mirrors the SVG visually.
 */
async function svgToPng(svgBytes: Buffer): Promise<Buffer> {
  return sharp(svgBytes, { density: 384 })
    .resize({ width: 1024, height: 1024, fit: "inside", withoutEnlargement: false, background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

export async function generateLogo(input: GenerateLogoInput): Promise<GeneratedLogo> {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? (import.meta as any).env?.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not configured");

  let svg: string;
  let svgBytes: Buffer;
  try {
    const out = await generateSvgFromRecraft(input);
    svg = out.svg;
    svgBytes = out.bytes;
  } catch (e) {
    console.error("[logo-gen] Recraft generation failed:", e);
    throw e;
  }

  const pngBytes = await svgToPng(svgBytes);

  const ts = Date.now();
  const pngBlob = await put(`kits/${input.kitId}/logo-${ts}.png`, pngBytes, {
    access: "public",
    contentType: "image/png",
    token,
  });
  const svgBlob = await put(`kits/${input.kitId}/logo-${ts}.svg`, svg, {
    access: "public",
    contentType: "image/svg+xml",
    token,
  });

  return {
    pngUrl: pngBlob.url,
    svgUrl: svgBlob.url,
    pngBytes: pngBytes.length,
    svgBytes: svgBytes.length,
  };
}
