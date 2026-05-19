// ── Curated Google Fonts list ──────────────────────────────────────────────
// ~150 popular families used across the press-kit editor. Each entry includes
// its category so the searchable combobox can group / filter them.
// All names are exact Google Fonts family names — feed them directly into
// `https://fonts.googleapis.com/css2?family=...&display=swap`.

export type FontCategory = "sans" | "serif" | "display" | "mono" | "handwriting";

export interface GoogleFont {
  family: string;
  category: FontCategory;
}

export const GOOGLE_FONTS: GoogleFont[] = [
  // ── Sans ─────────────────────────────────────────────────────────────────
  { family: "Inter", category: "sans" },
  { family: "Manrope", category: "sans" },
  { family: "Space Grotesk", category: "sans" },
  { family: "IBM Plex Sans", category: "sans" },
  { family: "Plus Jakarta Sans", category: "sans" },
  { family: "DM Sans", category: "sans" },
  { family: "Work Sans", category: "sans" },
  { family: "Karla", category: "sans" },
  { family: "Nunito", category: "sans" },
  { family: "Mulish", category: "sans" },
  { family: "Outfit", category: "sans" },
  { family: "Sora", category: "sans" },
  { family: "Public Sans", category: "sans" },
  { family: "Onest", category: "sans" },
  { family: "Albert Sans", category: "sans" },
  { family: "Archivo", category: "sans" },
  { family: "Familjen Grotesk", category: "sans" },
  { family: "Reddit Sans", category: "sans" },
  { family: "Funnel Sans", category: "sans" },
  { family: "Instrument Sans", category: "sans" },
  { family: "Bricolage Grotesque", category: "sans" },
  { family: "Lato", category: "sans" },
  { family: "Open Sans", category: "sans" },
  { family: "Roboto", category: "sans" },
  { family: "Montserrat", category: "sans" },
  { family: "Poppins", category: "sans" },
  { family: "Source Sans 3", category: "sans" },
  { family: "Rubik", category: "sans" },
  { family: "Hanken Grotesk", category: "sans" },
  { family: "Figtree", category: "sans" },
  { family: "Geologica", category: "sans" },
  { family: "Be Vietnam Pro", category: "sans" },
  { family: "Barlow", category: "sans" },
  { family: "Heebo", category: "sans" },
  { family: "Assistant", category: "sans" },
  { family: "Urbanist", category: "sans" },
  { family: "Lexend", category: "sans" },
  { family: "Inria Sans", category: "sans" },
  { family: "Schibsted Grotesk", category: "sans" },
  { family: "Wix Madefor Display", category: "sans" },

  // ── Serif ────────────────────────────────────────────────────────────────
  { family: "Playfair Display", category: "serif" },
  { family: "Cormorant Garamond", category: "serif" },
  { family: "Fraunces", category: "serif" },
  { family: "EB Garamond", category: "serif" },
  { family: "Lora", category: "serif" },
  { family: "Spectral", category: "serif" },
  { family: "Crimson Pro", category: "serif" },
  { family: "Libre Caslon Text", category: "serif" },
  { family: "Newsreader", category: "serif" },
  { family: "DM Serif Display", category: "serif" },
  { family: "DM Serif Text", category: "serif" },
  { family: "Bodoni Moda", category: "serif" },
  { family: "Italiana", category: "serif" },
  { family: "Cardo", category: "serif" },
  { family: "Source Serif 4", category: "serif" },
  { family: "Instrument Serif", category: "serif" },
  { family: "Libre Baskerville", category: "serif" },
  { family: "Merriweather", category: "serif" },
  { family: "PT Serif", category: "serif" },
  { family: "Cormorant", category: "serif" },
  { family: "Crimson Text", category: "serif" },
  { family: "Tinos", category: "serif" },
  { family: "Vollkorn", category: "serif" },
  { family: "Old Standard TT", category: "serif" },
  { family: "Marcellus", category: "serif" },
  { family: "Marcellus SC", category: "serif" },
  { family: "Cinzel", category: "serif" },
  { family: "Forum", category: "serif" },
  { family: "Prata", category: "serif" },
  { family: "Gloock", category: "serif" },
  { family: "Caladea", category: "serif" },
  { family: "Bricolage Grotesque", category: "serif" },
  { family: "Young Serif", category: "serif" },
  { family: "Fraunces", category: "serif" },
  { family: "Literata", category: "serif" },
  { family: "Tenor Sans", category: "sans" },

  // ── Display ──────────────────────────────────────────────────────────────
  { family: "Unbounded", category: "display" },
  { family: "Syne", category: "display" },
  { family: "Bebas Neue", category: "display" },
  { family: "Anton", category: "display" },
  { family: "Oswald", category: "display" },
  { family: "Khand", category: "display" },
  { family: "Tenor Sans", category: "display" },
  { family: "Big Shoulders Display", category: "display" },
  { family: "Cabin", category: "sans" },
  { family: "Abril Fatface", category: "display" },
  { family: "Alfa Slab One", category: "display" },
  { family: "Russo One", category: "display" },
  { family: "Bungee", category: "display" },
  { family: "Major Mono Display", category: "display" },
  { family: "Monoton", category: "display" },
  { family: "Righteous", category: "display" },
  { family: "Bowlby One", category: "display" },
  { family: "Staatliches", category: "display" },
  { family: "League Spartan", category: "display" },
  { family: "Anybody", category: "display" },
  { family: "Climate Crisis", category: "display" },

  // ── Monospace ────────────────────────────────────────────────────────────
  { family: "JetBrains Mono", category: "mono" },
  { family: "IBM Plex Mono", category: "mono" },
  { family: "Space Mono", category: "mono" },
  { family: "Fira Code", category: "mono" },
  { family: "DM Mono", category: "mono" },
  { family: "Roboto Mono", category: "mono" },
  { family: "Source Code Pro", category: "mono" },
  { family: "Inconsolata", category: "mono" },
  { family: "Geist Mono", category: "mono" },
  { family: "Anonymous Pro", category: "mono" },
  { family: "Cousine", category: "mono" },
  { family: "Fragment Mono", category: "mono" },

  // ── Handwriting / Script ─────────────────────────────────────────────────
  { family: "Caveat", category: "handwriting" },
  { family: "Dancing Script", category: "handwriting" },
  { family: "Pacifico", category: "handwriting" },
  { family: "Great Vibes", category: "handwriting" },
  { family: "Sacramento", category: "handwriting" },
  { family: "Allura", category: "handwriting" },
];

// Deduplicate (a few may repeat across categories above)
const _seen = new Set<string>();
const _deduped: GoogleFont[] = [];
for (const f of GOOGLE_FONTS) {
  if (_seen.has(f.family)) continue;
  _seen.add(f.family);
  _deduped.push(f);
}
GOOGLE_FONTS.length = 0;
GOOGLE_FONTS.push(..._deduped);

export const FONT_FAMILIES = GOOGLE_FONTS.map(f => f.family);
