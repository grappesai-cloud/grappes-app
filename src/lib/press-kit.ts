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

// ── Server-side palette extraction from a logo URL ─────────────────────────
// Uses node-vibrant. Returns null if extraction fails (corrupt image, etc.) —
// caller falls back to DEFAULT_PALETTE or the previous palette.
export async function extractPaletteFromLogo(logoUrl: string): Promise<Palette | null> {
  try {
    const palette = await Vibrant.from(logoUrl).getPalette();
    const primary   = palette.Vibrant?.hex   ?? palette.DarkVibrant?.hex   ?? "#0a0a0a";
    const secondary = palette.Muted?.hex     ?? palette.DarkMuted?.hex     ?? "#262626";
    const accent    = palette.LightVibrant?.hex ?? palette.LightMuted?.hex ?? "#22d3ee";
    const text      = palette.DarkMuted?.hex  ?? palette.DarkVibrant?.hex  ?? "#0a0a0a";
    const bg        = palette.LightMuted?.hex ?? "#fafafa";
    return { primary, secondary, accent, text, bg, extracted_from_logo: true };
  } catch (err) {
    console.error("[press-kit] palette extraction failed:", err);
    return null;
  }
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
