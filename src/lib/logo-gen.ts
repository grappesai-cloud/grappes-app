// ── AI Logo Generator pipeline ─────────────────────────────────────────────
// 3 steps:
//   1. OpenAI gpt-image-1 generates a logo on white background with strict
//      flat-vector rules (no shadows, no gradients, no text).
//   2. Background removal: sharp threshold turns near-white pixels transparent.
//   3. Vectorization: @neplex/vectorizer (Rust/N-API) traces the PNG into SVG.
//
// Returns { pngUrl, svgUrl } — both uploaded to Vercel Blob under the kit's
// asset prefix. Caller persists to kit.assets.logo + kit.assets.logo_svg.

import OpenAI from "openai";
import sharp from "sharp";
import { vectorize } from "@neplex/vectorizer";
// Avoid importing the const-enums directly (TS verbatimModuleSyntax rejects them).
// Numeric values mirror the @neplex/vectorizer enum definitions at v0.0.5.
const ColorMode_Color = 0;
const Hierarchical_Stacked = 0;
const PathSimplifyMode_Spline = 2;
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

const SYSTEM_PROMPT_RULES = [
  "flat vector logo mark, single or two-tone solid color silhouette, perfectly centered",
  "soft off-white #FAFAFA background — no harsh pure white",
  "NO gradients, NO drop shadows, NO inner shadows, NO outer glow, NO bevels, NO 3D",
  "NO photorealism, NO photographs, NO textures, NO noise",
  "NO text, NO letters, NO numbers anywhere in the image",
  "thick clean shapes, geometric or organic, recognizable at 16px favicon scale",
  "high contrast against the background — large solid shapes that vectorize cleanly to SVG",
  "negative space allowed inside the mark",
].join("; ");

export interface GeneratedLogo {
  pngUrl: string;
  svgUrl: string;
  pngBytes: number;
  svgBytes: number;
}

export interface GenerateLogoInput {
  kitId: string;
  /** User-provided description: brand name + what they do */
  description: string;
  /** Optional hex color the user wants for the mark. */
  primaryColor?: string;
  /**
   * Optional set of palette hexes (primary/accent/secondary) already chosen
   * for the kit. When present, gpt-image-1 is told to use one of these as the
   * dominant fill so the logo coheres with the rest of the kit.
   */
  paletteColors?: string[];
  /** Optional style adjective: "minimalist", "bold", "playful", etc. */
  style?: string;
}

/**
 * Step 1: gpt-image-1 → raw PNG (white background).
 * Returns the raw PNG bytes.
 */
async function generateRawLogo(input: GenerateLogoInput): Promise<Buffer> {
  const apiKey = process.env.OPENAI_API_KEY ?? import.meta.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const openai = new OpenAI({ apiKey });

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

  const prompt = `Design a flat vector LOGO MARK (no text, no wordmark) for: "${input.description}".
${colorHint}
${styleHint}
STRICT VISUAL RULES: ${SYSTEM_PROMPT_RULES}.
The result will be vectorized to SVG, so it must be a clean silhouette with strong contrast against the off-white background.`;

  const res = await openai.images.generate({
    model: "gpt-image-1",
    prompt,
    size: "1024x1024",
    n: 1,
    background: "opaque",
    output_format: "png",
    moderation: "low",
  });

  const b64 = res.data?.[0]?.b64_json;
  if (!b64) throw new Error("OpenAI returned no image data");
  return Buffer.from(b64, "base64");
}

/**
 * Step 2: sharp pipeline — make near-white pixels transparent + crop to content.
 * Uses an alpha threshold so anti-aliased edges stay smooth.
 */
async function makeTransparent(rawPng: Buffer): Promise<Buffer> {
  // Read the raw image with alpha channel
  const img = sharp(rawPng).ensureAlpha();
  const { data, info } = await img.raw().toBuffer({ resolveWithObject: true });

  const { width, height, channels } = info;
  const out = Buffer.from(data); // copy
  for (let i = 0; i < out.length; i += channels) {
    const r = out[i], g = out[i + 1], b = out[i + 2];
    // Near-white: all channels >= 240
    if (r >= 240 && g >= 240 && b >= 240) {
      out[i + 3] = 0; // fully transparent
    } else if (r >= 220 && g >= 220 && b >= 220) {
      // Anti-aliased edge: scale alpha smoothly between 220 and 240
      const lightest = Math.max(r, g, b);
      const ratio = (lightest - 220) / 20;
      out[i + 3] = Math.round(255 * (1 - ratio));
    }
  }

  // Re-encode + auto-crop transparent borders
  return sharp(out, { raw: { width, height, channels: channels as 4 } })
    .trim({ background: { r: 255, g: 255, b: 255, alpha: 0 }, threshold: 10 })
    .png({ compressionLevel: 9, palette: false })
    .toBuffer();
}

/**
 * Step 3: vectorize PNG to SVG using @neplex/vectorizer (vtracer N-API binding).
 * Tuned for clean flat logos.
 */
async function vectorizeToSvg(transparentPng: Buffer): Promise<string> {
  const svg = await vectorize(transparentPng, {
    colorMode: ColorMode_Color as any,
    colorPrecision: 6,
    filterSpeckle: 8,
    spliceThreshold: 45,
    cornerThreshold: 60,
    hierarchical: Hierarchical_Stacked as any,
    mode: PathSimplifyMode_Spline as any,
    layerDifference: 16,
    lengthThreshold: 5,
    maxIterations: 12,
    pathPrecision: 5,
  });
  return svg;
}

/**
 * Full pipeline: prompt → raw PNG → transparent PNG → SVG.
 * Both PNG and SVG get uploaded to Vercel Blob and returned as URLs.
 */
export async function generateLogo(input: GenerateLogoInput): Promise<GeneratedLogo> {
  const token = process.env.BLOB_READ_WRITE_TOKEN ?? import.meta.env.BLOB_READ_WRITE_TOKEN;
  if (!token) throw new Error("BLOB_READ_WRITE_TOKEN not configured");

  // 1. Generate
  const rawPng = await generateRawLogo(input);

  // 2. Transparent
  const transparentPng = await makeTransparent(rawPng);

  // 3. SVG (best-effort: if vectorization fails, we still return PNG)
  let svg = "";
  try {
    svg = await vectorizeToSvg(transparentPng);
  } catch (e) {
    console.error("[logo-gen] vectorize failed (continuing with PNG only):", e);
  }

  // 4. Upload to Blob
  const ts = Date.now();
  const pngBlob = await put(`kits/${input.kitId}/logo-${ts}.png`, transparentPng, {
    access: "public",
    contentType: "image/png",
    token,
  });

  let svgUrl = "";
  if (svg) {
    const svgBlob = await put(`kits/${input.kitId}/logo-${ts}.svg`, svg, {
      access: "public",
      contentType: "image/svg+xml",
      token,
    });
    svgUrl = svgBlob.url;
  }

  return {
    pngUrl: pngBlob.url,
    svgUrl,
    pngBytes: transparentPng.length,
    svgBytes: svg.length,
  };
}
