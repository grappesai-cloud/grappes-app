// ── Brand Book Lab: row loading shared by viewer/pdf/html endpoints ───────────

import { createAdminClient } from './supabase';
import { renderBrandBookHTML, type BrandBookDoc } from './brandbook-template';
import { renderAkriviHTML } from './brandbook-akrivi';
import { DEFAULT_DONTS, type BrandBookContent } from './brandbook-gen';

export type BrandBookTemplate = 'editorial' | 'corporate' | 'urban' | 'contemporary';

export interface BrandBookRow {
  id: string;
  user_id: string;
  name: string;
  tagline: string | null;
  logo_url: string;
  typeface: string | null;
  template: BrandBookTemplate | null;
  palette_named: Array<{ hex: string; label?: string }> | null;
  donts: string[] | null;
  book_content: BrandBookContent | null;
  created_at: string;
}

export async function loadBrandBook(id: string, userId: string): Promise<BrandBookRow | null> {
  const client = createAdminClient();
  const { data, error } = await client
    .from('press_kits')
    .select('id, user_id, name, tagline, logo_url, typeface, template, palette_named, donts, book_content, created_at')
    .eq('id', id)
    .eq('user_id', userId)
    .eq('mode', 'brand_book')
    .single();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as BrandBookRow | null) ?? null;
}

/** Render the document HTML with the row's chosen template. */
export function renderBookHTML(row: BrandBookRow, doc: BrandBookDoc): string {
  const t = row.template;
  if (t === 'corporate' || t === 'urban' || t === 'contemporary') return renderAkriviHTML(doc, t);
  return renderBrandBookHTML(doc);
}

export function toDoc(row: BrandBookRow): BrandBookDoc | null {
  if (!row.book_content || !row.logo_url) return null;
  return {
    name: row.name,
    logoUrl: row.logo_url,
    typeface: row.typeface || 'Inter',
    colors: Array.isArray(row.palette_named) ? row.palette_named : [],
    donts: Array.isArray(row.donts) && row.donts.length ? row.donts : DEFAULT_DONTS,
    content: row.book_content,
  };
}
