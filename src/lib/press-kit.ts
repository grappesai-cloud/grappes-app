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

export interface PressKit {
  id: string;
  user_id: string;
  status: "draft" | "published";
  slug: string | null;
  kit_type: KitType;
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
    portrait?: string;
    photos?: string[];
    videos?: string[];
    press_logos?: string[];
  };
  press: { name: string; url?: string; year?: string; quote?: string }[];
  awards: { name: string; year?: string; issuer?: string }[];
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
