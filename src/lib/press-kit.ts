// ── Press Kit utilities ────────────────────────────────────────────────────
// Palette extraction from logo (server-side via node-vibrant), font pairings
// per kit type, slug generation, and the in-memory kit shape used across the
// UI + API.

import { Vibrant } from "node-vibrant/node";

export type KitType = "musician" | "agency" | "photographer" | "founder" | "model" | "other";

export interface Palette {
  primary: string;
  secondary: string;
  accent: string;
  text: string;
  bg: string;
  extracted_from_logo?: boolean;
}

export interface Fonts {
  heading: string;
  body: string;
  auto?: boolean;
}

export type KitMode = "press_kit" | "brand_book";

// ── DENY-style press kit role chip ────────────────────────────────────────
// Drives copy in the rebuilt wizard + section labels in the PDF (Discography
// vs Portfolio, etc.). 'other' allows a free-text role string stored on the
// kit alongside this enum value.
export type KitRole =
  | "dj" | "producer" | "musician" | "photographer"
  | "founder" | "model" | "athlete" | "brand" | "other";

export interface BookingAgent {
  name: string;
  email?: string;
  phone?: string;
  role?: string; // e.g. "Worldwide", "Romania", "Management"
}

export interface PressKit {
  id: string;
  user_id: string;
  status: "draft" | "published";
  slug: string | null;
  kit_type: KitType;
  mode: KitMode;
  name: string;
  tagline: string | null;
  bio_short: string | null;
  bio_long: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  contact_other: string | null;
  palette: Palette;
  fonts: Fonts;
  links: { platform: string; url: string; label?: string }[];
  stats: { value: string; label: string }[];
  assets: {
    logo?: string;
    logo_svg?: string;
    logo_refs?: string[];
    portrait?: string;
    photos?: string[];
    videos?: string[];
    press_logos?: string[];
    // DENY-style additions
    cover_portrait?: string;     // dominant cover photo
    spread_portraits?: string[]; // left-half portraits cycled through spreads
    signature?: string;          // transparent PNG of user signature (optional)
    // Brand Book additions
    mascot?: string;             // optional mascot illustration / element
  };
  press: { name: string; url?: string; year?: string; quote?: string; role?: string; title?: string }[];
  awards: { name: string; year?: string; issuer?: string }[];

  // ── DENY-style structured fields (PR 2) ───────────────────────────────
  role: KitRole | string;
  overview_intro?: string;                                            // short intro paragraph on Overview page
  key_highlights: string[];                                           // bullet list on Overview page
  shared_stage: string | null;                                        // comma-separated names
  career: {
    festivals?: string[];
    international?: string[];
    charts?: string[];
  };
  big_stats: { label: string; value: string }[];                      // headline numbers on Statistics page
  booking: {
    agents?: BookingAgent[];
    management?: BookingAgent;
    press_link?: string;
    instagram?: string;
  };

  // ── Brand Book structured fields (PR 3) ────────────────────────────────
  industry?: string | null;
  voice_keywords?: string | null;
  voice_paragraph?: string | null;
  palette_named?: { hex: string; label?: string; role?: string }[];
  applications?: string[]; // MockupId[] but kept loose to avoid cross-import
  donts?: string[];
  // Optional mascot asset lives in assets.mascot (typed below).

  template_version: number;
  stripe_session_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
}

// ── Curated Google Fonts pairings per kit type ─────────────────────────────
// First entry of each pair is heading, second is body. Loaded via the standard
// Google Fonts CSS link in the kit page <head>.
export const FONT_PAIRINGS_BY_TYPE: Record<KitType, Fonts> = {
  musician:     { heading: "Unbounded", body: "Inter" },
  agency:       { heading: "Space Grotesk", body: "Inter" },
  photographer: { heading: "Playfair Display", body: "Inter" },
  founder:      { heading: "Bricolage Grotesque", body: "Inter" },
  model:        { heading: "Cormorant Garamond", body: "Inter" },
  other:        { heading: "Inter", body: "Inter" },
};

export function defaultFontsFor(kitType: KitType): Fonts {
  return { ...FONT_PAIRINGS_BY_TYPE[kitType] ?? FONT_PAIRINGS_BY_TYPE.other, auto: true };
}

// ── Default palette when no logo + no manual input ─────────────────────────
export const DEFAULT_PALETTE: Palette = {
  primary:   "#0a0a0a",
  secondary: "#262626",
  accent:    "#22d3ee",
  text:      "#0a0a0a",
  bg:        "#fafafa",
};

// ── Color theory helpers ────────────────────────────────────────────────────
function hexToHslTuple(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  const v = m ? parseInt(m[1], 16) : 0;
  const r = ((v >> 16) & 0xff) / 255, g = ((v >> 8) & 0xff) / 255, b = (v & 0xff) / 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return [h * 360, s, l];
}
function hslToHex(h: number, s: number, l: number): string {
  h = ((h % 360) + 360) % 360 / 360;
  s = Math.max(0, Math.min(1, s));
  l = Math.max(0, Math.min(1, l));
  let r: number, g: number, b: number;
  if (s === 0) { r = g = b = l; }
  else {
    const hue2rgb = (p: number, q: number, t: number) => {
      if (t < 0) t += 1;
      if (t > 1) t -= 1;
      if (t < 1/6) return p + (q - p) * 6 * t;
      if (t < 1/2) return q;
      if (t < 2/3) return p + (q - p) * (2/3 - t) * 6;
      return p;
    };
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1/3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1/3);
  }
  const toHex = (x: number) => Math.round(x * 255).toString(16).padStart(2, "0");
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

// ── Server-side palette extraction from a logo URL ─────────────────────────
// Returns ONLY colors actually present in the logo (no hardcoded fallbacks).
// For SVG logos we parse fill/stroke directly from markup (node-vibrant
// can't decode SVGs reliably and was returning null, which then froze the
// palette at DEFAULT_PALETTE forever). For PNG/JPG we use node-vibrant.
// Caller pairs this with fillPalette() to complete the 5-slot palette using
// color theory based on whatever was extracted.
export async function extractPaletteFromLogo(logoUrl: string): Promise<Palette | null> {
  const isSvg = logoUrl.toLowerCase().endsWith(".svg") || logoUrl.toLowerCase().includes(".svg?");
  try {
    let partial: Partial<Palette> | null = null;

    if (isSvg) {
      partial = await extractFromSvg(logoUrl);
    } else {
      partial = await extractViaVibrant(logoUrl);
    }

    if (!partial || Object.keys(partial).length === 0) return null;
    return { ...fillPalette(partial), extracted_from_logo: true };
  } catch (err) {
    console.error("[press-kit] palette extraction failed:", err);
    return null;
  }
}

// Parse fill / stroke colors directly from SVG markup, count each color's
// total path-byte footprint (rough proxy for surface area), classify by
// HSL → assign to primary / secondary / accent / bg / text slots.
async function extractFromSvg(svgUrl: string): Promise<Partial<Palette>> {
  const res = await fetch(svgUrl);
  if (!res.ok) throw new Error(`Failed to fetch SVG: ${res.status}`);
  const svg = await res.text();

  // Find all explicit fill/stroke colors with their containing path's length.
  // We weight each color by the byte-length of its parent <path d="..."> as a
  // cheap proxy for surface area on the canvas.
  type Entry = { hex: string; weight: number };
  const entries: Entry[] = [];

  // Match each element with a fill or stroke attribute + capture surrounding
  // path data length if present.
  const re = /<([a-z]+)[^>]*?\b(fill|stroke)\s*=\s*"([^"]+)"[^>]*?(?:d\s*=\s*"([^"]*)")?[^>]*?\/?>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(svg))) {
    const value = m[3];
    const pathData = m[4] ?? "";
    const hex = colorTokenToHex(value);
    if (!hex) continue;
    const weight = Math.max(pathData.length, 32);
    entries.push({ hex, weight });
  }

  if (entries.length === 0) return {};

  // Aggregate by hex.
  const totals = new Map<string, number>();
  for (const e of entries) totals.set(e.hex, (totals.get(e.hex) || 0) + e.weight);
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]).map(([hex]) => hex);

  // Bucket by lightness / saturation.
  const bgCandidate    = sorted.find(h => { const [, s, l] = hexToHslTuple(h); return l > 0.92 && s < 0.18; });
  const textCandidate  = sorted.find(h => { const [, s, l] = hexToHslTuple(h); return l < 0.18; });
  const colors         = sorted.filter(h => {
    const [, s, l] = hexToHslTuple(h);
    return s > 0.2 && l > 0.18 && l < 0.85; // chromatic, not too dark/light
  });

  const partial: Partial<Palette> = {};
  if (colors[0]) partial.primary = colors[0];
  if (colors[1]) partial.secondary = colors[1];
  // Accent = a 3rd chromatic color if present, otherwise complementary derived
  // by fillPalette() later.
  if (colors[2]) partial.accent = colors[2];
  if (bgCandidate) partial.bg = bgCandidate;
  if (textCandidate) partial.text = textCandidate;
  return partial;
}

function colorTokenToHex(raw: string): string | null {
  const v = raw.trim().toLowerCase();
  if (v === "none" || v === "transparent" || v === "currentcolor" || v.startsWith("url(")) return null;
  const hex6 = /^#?([0-9a-f]{6})$/i.exec(v);
  if (hex6) return `#${hex6[1].toLowerCase()}`;
  const hex3 = /^#?([0-9a-f]{3})$/i.exec(v);
  if (hex3) {
    const [r, g, b] = hex3[1].split("");
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  const rgb = /^rgb\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/i.exec(v);
  if (rgb) {
    const [r, g, b] = [+rgb[1], +rgb[2], +rgb[3]].map(n => Math.max(0, Math.min(255, n)).toString(16).padStart(2, "0"));
    return `#${r}${g}${b}`;
  }
  if (v === "white") return "#ffffff";
  if (v === "black") return "#000000";
  return null;
}

async function extractViaVibrant(logoUrl: string): Promise<Partial<Palette>> {
  const palette = await Vibrant.from(logoUrl).getPalette();
  const partial: Partial<Palette> = {};
  const primary   = palette.Vibrant?.hex   ?? palette.DarkVibrant?.hex ?? null;
  const secondary = palette.Muted?.hex     ?? palette.DarkMuted?.hex   ?? null;
  const accent    = palette.LightVibrant?.hex ?? null;
  const text      = palette.DarkMuted?.hex  ?? palette.DarkVibrant?.hex ?? null;
  const bg        = palette.LightMuted?.hex ?? null;
  if (primary) partial.primary = primary;
  if (secondary) partial.secondary = secondary;
  if (accent) partial.accent = accent;
  if (text) partial.text = text;
  if (bg) partial.bg = bg;
  return partial;
}

// ── Color-theory completion ────────────────────────────────────────────────
// Given a partial palette (typically 1-3 colors extracted from a logo), fill
// the remaining slots using HSL rotations so the final 5 colors are
// technically coherent (no random cyan when the logo is red).
//
// Rules:
//   - primary: required. If missing, fall back to the first non-empty slot or
//     a sensible neutral (#0a0a0a).
//   - secondary: same hue as primary, less saturated + slightly lighter.
//   - accent: complementary hue (180° from primary), bumped saturation.
//   - bg: very light tint of primary (L=0.97, S=0.04) — almost white but
//     hinted toward the brand.
//   - text: very dark shade of primary (L=0.10, S=0.30) — almost black with
//     a hint of the brand hue. Avoids absolute #000.
export function fillPalette(partial: Partial<Palette>): Palette {
  const primary = partial.primary || partial.secondary || partial.accent || partial.text || "#0a0a0a";
  const [h, s] = hexToHslTuple(primary);

  const secondary = partial.secondary || hslToHex(h, Math.max(0.18, s * 0.55), 0.32);
  const accent    = partial.accent    || hslToHex(h + 180, Math.max(0.55, s), 0.55);
  const bg        = partial.bg        || hslToHex(h, 0.04, 0.97);
  const text      = partial.text      || hslToHex(h, 0.30, 0.10);

  return {
    primary,
    secondary,
    accent,
    bg,
    text,
    extracted_from_logo: partial.primary != null,
  };
}

// ── Short shareable slug (10 chars base36) used in /kit/[slug] public URL ──
export function generateSlug(): string {
  const a = Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, "0");
  const b = Math.floor(Math.random() * 36 ** 5).toString(36).padStart(5, "0");
  return a + b;
}

// ── Google Fonts CSS URL builder ───────────────────────────────────────────
// Combines heading + body into one <link> for fewer requests.
export function googleFontsUrl(fonts: Fonts): string {
  const families: string[] = [];
  const head = fonts.heading.replace(/\s+/g, "+");
  const body = fonts.body.replace(/\s+/g, "+");
  // Weights covering common usage; load both fonts only once even if same
  if (head === body) {
    families.push(`family=${head}:wght@300;400;500;600;700;800`);
  } else {
    families.push(`family=${head}:wght@400;500;700;800`);
    families.push(`family=${body}:wght@300;400;500;600`);
  }
  return `https://fonts.googleapis.com/css2?${families.join("&")}&display=swap`;
}

// ── DENY-style accent derivation ───────────────────────────────────────────
// Picks ONE bold accent color used by the press-kit PDF (section titles,
// scribble overlays, key callouts). Rules:
//   1. Prefer palette.accent if its luminance is 0.15-0.65 AND saturation > 0.35
//   2. Else try palette.primary against the same gate
//   3. Else fall back to a curated pool, hashed by kit name for stability
const ACCENT_FALLBACK_POOL = [
  "#A3E635", // DENY lime
  "#22D3EE",
  "#F97316",
  "#FB7185",
  "#FBBF24",
  "#A78BFA",
  "#34D399",
];

function hexToHsl(hex: string): { h: number; s: number; l: number } | null {
  const m = hex.replace("#", "");
  if (m.length !== 6) return null;
  const r = parseInt(m.substring(0, 2), 16) / 255;
  const g = parseInt(m.substring(2, 4), 16) / 255;
  const b = parseInt(m.substring(4, 6), 16) / 255;
  if ([r, g, b].some(n => Number.isNaN(n))) return null;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  let h = 0, s = 0;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    switch (max) {
      case r: h = (g - b) / d + (g < b ? 6 : 0); break;
      case g: h = (b - r) / d + 2; break;
      case b: h = (r - g) / d + 4; break;
    }
    h /= 6;
  }
  return { h, s, l };
}

function isBoldAccent(hex: string | undefined | null): boolean {
  if (!hex) return false;
  const hsl = hexToHsl(hex);
  if (!hsl) return false;
  return hsl.l >= 0.15 && hsl.l <= 0.65 && hsl.s > 0.35;
}

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h * 31 + s.charCodeAt(i)) | 0;
  }
  return Math.abs(h);
}

export function accentForKit(kit: Pick<PressKit, "palette" | "name">): string {
  const p = kit.palette ?? ({} as Partial<Palette>);
  if (isBoldAccent(p.accent))  return p.accent!;
  if (isBoldAccent(p.primary)) return p.primary!;
  const key = (kit.name || "kit").toLowerCase();
  return ACCENT_FALLBACK_POOL[hashString(key) % ACCENT_FALLBACK_POOL.length];
}

// ── Helper: compute a readable foreground color for a given background ─────
// Light bg → dark text, dark bg → light text. Uses YIQ luminance check.
export function readableForeground(bgHex: string): string {
  const hex = bgHex.replace("#", "");
  if (hex.length !== 6) return "#0a0a0a";
  const r = parseInt(hex.substring(0, 2), 16);
  const g = parseInt(hex.substring(2, 4), 16);
  const b = parseInt(hex.substring(4, 6), 16);
  const yiq = (r * 299 + g * 587 + b * 114) / 1000;
  return yiq >= 128 ? "#0a0a0a" : "#fafafa";
}
