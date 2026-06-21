// ── Brand Book Lab: row loading shared by viewer/pdf/html/zip endpoints ───────
// Single template: the premium scrolling book in src/lib/brandbook-allone.ts.

import { createAdminClient } from './supabase';
import { renderAllOneHTML, type AllOneDoc, type BrandFont } from './brandbook-allone';
import { DEFAULT_DONTS, type BrandBookContent } from './brandbook-gen';

/** Per-role custom fonts the user uploaded (any subset). */
export interface CustomFonts {
  display?: BrandFont;
  text?: BrandFont;
  mono?: BrandFont;
}

export interface BrandBookRow {
  id: string;
  user_id: string;
  name: string;
  tagline: string | null;
  industry: string | null;
  logo_url: string;
  typeface: string | null;
  logo_is_light: boolean | null;
  palette_named: Array<{ hex: string; label?: string }> | null;
  donts: string[] | null;
  book_content: BrandBookContent | null;
  created_at: string;
  // Phase-2 columns (multi-mark + per-role fonts). Optional so the loader works
  // before the migration that adds them lands.
  symbol_url?: string | null;
  badge_url?: string | null;
  custom_fonts?: CustomFonts | null;
}

const SELECT =
  'id, user_id, name, tagline, industry, logo_url, symbol_url, badge_url, typeface, custom_fonts, logo_is_light, palette_named, donts, book_content, created_at';

export async function loadBrandBook(id: string, userId: string): Promise<BrandBookRow | null> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('press_kits')
    .select(SELECT)
    .eq('id', id)
    .eq('user_id', userId)
    .eq('mode', 'brand_book')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as BrandBookRow | null) ?? null;
}

// Default type roles. The user's single chosen typeface drives the display
// face; body stays a readable neutral and the functional voice a monospace.
// Any role the user uploaded a custom font for overrides the default.
function resolveFonts(row: BrandBookRow): AllOneDoc['fonts'] {
  const cf = row.custom_fonts || {};
  const display: BrandFont = cf.display || { family: row.typeface || 'Space Grotesk' };
  const text: BrandFont = cf.text || { family: 'Inter' };
  const mono: BrandFont = cf.mono || { family: 'Space Mono' };
  return { display, text, mono };
}

export interface ToDocOpts {
  /** Include the in-book Downloads section (viewer only, not PDF). */
  downloads?: boolean;
}

export function toDoc(row: BrandBookRow, opts: ToDocOpts = {}): AllOneDoc | null {
  if (!row.book_content || !row.logo_url) return null;
  const c = row.book_content;
  return {
    name: row.name,
    tagline: row.tagline || c.tagline || '',
    industry: row.industry || undefined,
    logoUrl: row.logo_url,
    symbolUrl: row.symbol_url || undefined,
    badgeUrl: row.badge_url || undefined,
    logoIsLight: row.logo_is_light !== false,
    colors: Array.isArray(row.palette_named) ? row.palette_named : [],
    fonts: resolveFonts(row),
    donts: Array.isArray(row.donts) && row.donts.length ? row.donts : DEFAULT_DONTS,
    content: c,
    downloads: opts.downloads
      ? {
          all: `/api/brandbook/${row.id}/zip`,
          logos: `/api/brandbook/${row.id}/zip?only=logos`,
          fonts: `/api/brandbook/${row.id}/zip?only=fonts`,
        }
      : undefined,
  };
}

/** Render the document HTML. Single premium template. */
export function renderBookHTML(_row: BrandBookRow, doc: AllOneDoc): string {
  return renderAllOneHTML(doc);
}
