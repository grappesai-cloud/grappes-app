// ── Brand Book Lab: logo transparency detection ──────────────────────────────
// The logo system page recolours the mark to white/ink via a CSS filter, which
// only works on a logo with a real alpha channel (a transparent silhouette).
// An opaque logo (one with a baked-in background) would be filtered into a solid
// block, so we detect that here and let the renderer fall back to showing the
// mark as supplied.

import sharp from 'sharp';

const cache = new Map<string, boolean>();

/**
 * True when the logo has genuine transparency (an alpha channel with at least
 * some transparent pixels). False for opaque images, broken URLs, or non-raster
 * formats we can't introspect. SVGs are treated as transparent (they usually are
 * and recolour cleanly).
 */
export async function logoHasTransparency(url: string): Promise<boolean> {
  if (!url) return false;
  const cached = cache.get(url);
  if (cached !== undefined) return cached;

  let result = false;
  try {
    if (/\.svg(\?|$)/i.test(url)) {
      result = true;
    } else {
      const res = await fetch(url);
      if (res.ok) {
        const buf = Buffer.from(await res.arrayBuffer());
        const meta = await sharp(buf).metadata();
        if (meta.hasAlpha) {
          const stats = await sharp(buf).stats();
          result = !stats.isOpaque;
        }
      }
    }
  } catch {
    result = false;
  }

  cache.set(url, result);
  return result;
}
