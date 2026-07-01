// ── AI Logo Generator pipeline (Recraft V4 Vector) ─────────────────────────
// Engine: Recraft external API at https://external.api.recraft.ai/v1.
// Flow:
//   1. If referenceImages are present, POST them as multipart/form-data to
//      /v1/styles with style="vector_illustration" to obtain a style_id.
//      Style transfer requires the V3 vector model (V4 does not yet support
//      style_id), so we route those generations through `recraftv3_vector`.
//   2. POST to /v1/images/generations:
//        - default model: `recraftv4_vector` + style="vector_illustration"
//        - with refs:     `recraftv3_vector` + style_id (NO `style` — the two
//          are mutually exclusive; sending both is a 400)
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
import { put } from '@lib/r2-blob';

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

/** Convert "#RRGGBB" or "RRGGBB" to [r,g,b] integer triplet, or null if invalid. */
function hexToRgb(hex: string): [number, number, number] | null {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return null;
  const v = parseInt(m[1], 16);
  return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
}

// Kept compact: Recraft caps the prompt at 1000 chars, so the rule list is
// terse on purpose while still carrying every hard constraint.
const BASE_RULES = [
  "flat vector silhouette, 1-2 solid colors",
  "off-white #FAFAFA background",
  "no gradients, shadows, 3D, photo or texture",
  "bold high-contrast shapes, readable at 32px",
];
const ICON_ONLY_RULES = [
  ...BASE_RULES,
  "icon mark only, no text or letters",
];
const WORDMARK_RULES = [
  ...BASE_RULES,
  "brand name as the logo in a sharp, readable custom letterform",
];
const COMBO_RULES = [
  ...BASE_RULES,
  "icon + brand name together as one mark with clear hierarchy",
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
  /**
   * Path prefix under which the SVG + PNG land in Vercel Blob. Press Kit Lab
   * passes `kits/<kit-id>`. Logo Lab (standalone) passes `logos/<user-id>`.
   * The previous `kitId` field still works (back-compat) but new callers
   * should pass `assetPrefix` directly.
   */
  assetPrefix?: string;
  /** @deprecated — pass `assetPrefix` instead. Kept for the existing press-kit endpoint. */
  kitId?: string;
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
/** Recraft hard-caps the prompt at 1000 chars; keep every field within budget. */
const PROMPT_MAX = 1000;
function clampText(s: string, max: number): string {
  const t = s.trim();
  return t.length > max ? t.slice(0, max).trimEnd() : t;
}

function buildPrompt(input: GenerateLogoInput): string {
  const logoType: LogoType = input.logoType ?? "icon";
  const brand = input.brandName?.trim();
  // The free-text brief is the unbounded part — cap it so the fixed scaffolding
  // (color + rules) always fits inside Recraft's 1000-char limit.
  const desc = clampText(input.description ?? "", 360);

  let colorHint: string;
  if (input.primaryColor) {
    // primaryColor wins over paletteColors. We also recolor the SVG post-hoc
    // (Recraft treats colors as a soft signal), but the prompt still helps.
    colorHint = `Single color only: ${input.primaryColor} (no other hues, no shading).`;
  } else if (input.paletteColors && input.paletteColors.length > 0) {
    const cs = input.paletteColors.slice(0, 3).join(", ");
    colorHint = `Palette: ${cs}; dominant = boldest, most saturated.`;
  } else {
    const accent = pickAccent();
    colorHint = `Single bold accent: ${accent.name} ${accent.hex}; never black or grey.`;
  }
  const styleHint = input.style ? ` Style: ${clampText(input.style, 80)}.` : "";
  const moodHint = input.mood ? ` Mood: ${clampText(input.mood, 60)}.` : "";

  let typeIntro: string;
  if (logoType === "wordmark") {
    typeIntro = `WORDMARK logo for "${brand ?? desc}": the name "${brand ?? ""}" as readable text in a strong custom letterform.${desc ? ` Brief: ${desc}.` : ""}`;
  } else if (logoType === "combination") {
    typeIntro = `COMBINATION mark for "${brand ?? desc}": an icon paired with the readable name "${brand ?? ""}" as one unit.${desc ? ` Concept: ${desc}.` : ""}`;
  } else {
    typeIntro = `ICON-ONLY logo mark, no text, for: "${desc || brand}"${brand ? ` (brand "${brand}")` : ""}.`;
  }

  const prompt = `${typeIntro} ${colorHint}${styleHint}${moodHint} Rules: ${rulesFor(logoType)}. Honor the description literally.`;
  return clampText(prompt, PROMPT_MAX);
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
  };
  if (styleId) {
    // Style transfer only available on V3 (per Recraft docs as of 2026-02).
    // `style` and `style_id` are mutually exclusive — sending both is a 400,
    // so a reference style_id replaces the named style entirely.
    body.model = "recraftv3_vector";
    body.style_id = styleId;
  } else {
    body.model = "recraftv4_vector";
    body.style = "vector_illustration";
  }

  // Color constraint: when the user explicitly forced a color (primaryColor)
  // or has a kit palette set, pass them via Recraft's `controls.colors` so the
  // output is HARD-constrained to those hues — putting a hex in the prompt
  // text was being ignored (Recraft treats color tokens as weak signal).
  const constraintColors: number[][] = [];
  if (input.primaryColor) {
    const rgb = hexToRgb(input.primaryColor);
    if (rgb) constraintColors.push(rgb);
  }
  if (constraintColors.length === 0 && input.paletteColors) {
    for (const c of input.paletteColors.slice(0, 3)) {
      const rgb = hexToRgb(c);
      if (rgb) constraintColors.push(rgb);
    }
  }
  if (constraintColors.length > 0) {
    body.controls = { colors: constraintColors.map((rgb) => ({ rgb })) };
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
 * Force foreground fills (and explicit strokes) in the SVG to a single hex
 * color. Recraft's `controls.colors` is documented as a "preferable" signal —
 * V4 routinely drifts to other hues. When the user explicitly forces a color
 * we recolor the geometry deterministically.
 *
 * Critically we PRESERVE background fills (Recraft typically draws an
 * off-white #FAFAFA backplate as the first rect). Heuristic: any color
 * whose R, G, B channels are all >= 235 is treated as background.
 * We also leave fill="none" and url(...) references alone.
 */
function recolorSvgMono(svg: string, hex: string): string {
  const safeHex = /^#?[0-9a-fA-F]{6}$/.test(hex) ? (hex.startsWith("#") ? hex : `#${hex}`) : null;
  if (!safeHex) return svg;

  // Parse various color forms to RGB, return null if unparseable.
  function parseColor(s: string): [number, number, number] | null {
    const t = s.trim().toLowerCase();
    if (t === "none" || t === "currentcolor" || t === "transparent") return null;
    if (t.startsWith("url(")) return null;
    // Hex #rgb or #rrggbb
    const h6 = /^#?([0-9a-f]{6})$/i.exec(t);
    if (h6) {
      const v = parseInt(h6[1], 16);
      return [(v >> 16) & 0xff, (v >> 8) & 0xff, v & 0xff];
    }
    const h3 = /^#?([0-9a-f]{3})$/i.exec(t);
    if (h3) {
      const v = parseInt(h3[1], 16);
      const r = ((v >> 8) & 0xf) * 17;
      const g = ((v >> 4) & 0xf) * 17;
      const b = (v & 0xf) * 17;
      return [r, g, b];
    }
    const rgb = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(t);
    if (rgb) return [+rgb[1], +rgb[2], +rgb[3]];
    if (t === "white") return [255, 255, 255];
    if (t === "black") return [0, 0, 0];
    return null;
  }
  function isBackground(rgb: [number, number, number] | null): boolean {
    if (!rgb) return false;
    // Near-white plate — leave alone.
    return rgb[0] >= 235 && rgb[1] >= 235 && rgb[2] >= 235;
  }

  function maybeReplace(val: string, replacement: string): string {
    const v = val.trim().toLowerCase();
    if (v === "none" || v === "transparent" || v.startsWith("url(")) return val;
    const rgb = parseColor(val);
    if (isBackground(rgb)) return val; // keep backplate
    return replacement;
  }

  let out = svg.replace(/fill\s*=\s*"([^"]+)"/g, (_m, val) => {
    const next = maybeReplace(val, safeHex);
    return `fill="${next}"`;
  });
  out = out.replace(/stroke\s*=\s*"([^"]+)"/g, (_m, val) => {
    const next = maybeReplace(val, safeHex);
    return `stroke="${next}"`;
  });
  out = out.replace(/fill\s*:\s*([^;"]+)/g, (_m, val) => {
    const next = maybeReplace(val, safeHex);
    return `fill:${next}`;
  });
  out = out.replace(/stroke\s*:\s*([^;"]+)/g, (_m, val) => {
    const next = maybeReplace(val, safeHex);
    return `stroke:${next}`;
  });
  return out;
}

/** Parse a near-white test on an rgb()/hex colour string. Returns true for the
 *  off-white backplate Recraft draws (all channels >= 235). */
function isNearWhite(val: string): boolean {
  const t = val.trim().toLowerCase();
  let r: number, g: number, b: number;
  const rgb = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(t);
  const h6 = /^#?([0-9a-f]{6})$/i.exec(t);
  if (rgb) { r = +rgb[1]; g = +rgb[2]; b = +rgb[3]; }
  else if (h6) { const v = parseInt(h6[1], 16); r = (v >> 16) & 0xff; g = (v >> 8) & 0xff; b = v & 0xff; }
  else if (t === 'white') { r = g = b = 255; }
  else return false;
  return r >= 235 && g >= 235 && b >= 235;
}

/**
 * Strip the opaque backplate so the logo is transparent (PNG + SVG). Recraft
 * draws a full-canvas off-white rectangle (as the first <path> or a <rect>) as
 * the "paper". We remove ONLY elements whose geometry covers the whole viewBox
 * AND whose fill is near-white — never coloured shapes, and never the smaller
 * near-white DETAILS inside the mark (those aren't full-canvas).
 */
export function stripSvgBackground(svg: string): string {
  // Canvas size from viewBox (preferred) or width/height.
  let W = 0, H = 0;
  const vb = /viewBox\s*=\s*"([-\d.\s]+)"/i.exec(svg);
  if (vb) { const p = vb[1].trim().split(/[\s,]+/).map(Number); if (p.length === 4) { W = p[2]; H = p[3]; } }
  if (!W || !H) {
    const w = /\bwidth\s*=\s*"([\d.]+)"/i.exec(svg); const h = /\bheight\s*=\s*"([\d.]+)"/i.exec(svg);
    if (w) W = +w[1]; if (h) H = +h[1];
  }
  if (!W || !H) return svg; // can't reason about geometry — leave untouched
  const tol = Math.max(W, H) * 0.02;
  const near = (v: number, target: number) => Math.abs(v - target) <= tol;

  // True when a path `d` traces the full-canvas rectangle (all vertices on the
  // outer corners, bounding box ≈ the whole viewBox).
  const isFullCanvasPath = (d: string): boolean => {
    const nums = (d.match(/-?\d*\.?\d+(?:e-?\d+)?/gi) || []).map(Number);
    if (nums.length < 8 || nums.length > 14) return false; // a rect is 4–6 points
    const xs: number[] = [], ys: number[] = [];
    for (let i = 0; i + 1 < nums.length; i += 2) { xs.push(nums[i]); ys.push(nums[i + 1]); }
    const onCorner = xs.every((x, i) => (near(x, 0) || near(x, W)) && (near(ys[i], 0) || near(ys[i], H)));
    if (!onCorner) return false;
    const spanX = Math.max(...xs) - Math.min(...xs);
    const spanY = Math.max(...ys) - Math.min(...ys);
    return spanX >= W - tol && spanY >= H - tol;
  };

  let removed = 0;
  // Remove backplate <path> elements (Recraft emits `<path ...></path>`).
  let out = svg.replace(/<path\b([^>]*)>(\s*<\/path>)?/gi, (m, attrs) => {
    const fill = /fill\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? '';
    const d = /\bd\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? '';
    if (d && isNearWhite(fill) && isFullCanvasPath(d)) { removed++; return ''; }
    return m;
  });
  // Remove a full-canvas near-white <rect> backplate, if present instead.
  out = out.replace(/<rect\b([^>]*)\/?>(\s*<\/rect>)?/gi, (m, attrs) => {
    const fill = /fill\s*=\s*"([^"]+)"/i.exec(attrs)?.[1] ?? '';
    const x = +(/(?:^|\s)x\s*=\s*"([-\d.]+)"/i.exec(attrs)?.[1] ?? '0');
    const y = +(/(?:^|\s)y\s*=\s*"([-\d.]+)"/i.exec(attrs)?.[1] ?? '0');
    const w = +(/(?:^|\s)width\s*=\s*"([-\d.]+)"/i.exec(attrs)?.[1] ?? '0');
    const h = +(/(?:^|\s)height\s*=\s*"([-\d.]+)"/i.exec(attrs)?.[1] ?? '0');
    if (isNearWhite(fill) && near(x, 0) && near(y, 0) && w >= W - tol && h >= H - tol) { removed++; return ''; }
    return m;
  });
  return removed > 0 ? out : svg;
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

  // Transparency: drop the off-white backplate Recraft paints so the SVG + PNG
  // are transparent. This lets the mark drop cleanly onto any background and
  // unlocks the reversed/single-colour variants in Brand Book Lab.
  svg = stripSvgBackground(svg);
  svgBytes = Buffer.from(svg, "utf8");

  // Deterministic color enforcement: when the user explicitly picked a color
  // (Force a specific color), Recraft's soft signal isn't reliable on V4 — so
  // we recolor the SVG geometry directly. This is safe for monochrome marks,
  // which is what 95% of brand logos are.
  if (input.primaryColor) {
    svg = recolorSvgMono(svg, input.primaryColor);
    svgBytes = Buffer.from(svg, "utf8");
  }

  const pngBytes = await svgToPng(svgBytes);

  const ts = Date.now();
  const prefix = input.assetPrefix ?? (input.kitId ? `kits/${input.kitId}` : `logos/misc`);
  const pngBlob = await put(`${prefix}/logo-${ts}.png`, pngBytes, {
    access: "public",
    contentType: "image/png",
  });
  const svgBlob = await put(`${prefix}/logo-${ts}.svg`, svg, {
    access: "public",
    contentType: "image/svg+xml",
  });

  return {
    pngUrl: pngBlob.url,
    svgUrl: svgBlob.url,
    pngBytes: pngBytes.length,
    svgBytes: svgBytes.length,
  };
}
