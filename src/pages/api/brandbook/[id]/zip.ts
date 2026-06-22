// ── GET /api/brandbook/[id]/zip — downloadable asset pack ─────────────────────
// Bundles the brand book and its assets into one ZIP:
//   brand-book.html · brand-guidelines.md · logos/ (original + white/black/accent
//   recolours, SVG passthrough + PNG) · fonts/ (custom uploads + a Google note).
// ?only=logos or ?only=fonts narrows the pack.

import type { APIRoute } from 'astro';
import JSZip from 'jszip';
import sharp from 'sharp';
import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { loadBrandBook, toDoc } from '../../../../lib/brandbook-db';
import { renderAllOneHTML } from '../../../../lib/brandbook-allone';
import { logoHasTransparency } from '../../../../lib/brandbook-logo';

function slugify(s: string): string {
  return (s || 'brand').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'brand';
}
function hexToRgb(hex: string) {
  const h = (hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(v.slice(0, 2), 16) || 0, g: parseInt(v.slice(2, 4), 16) || 0, b: parseInt(v.slice(4, 6), 16) || 0 };
}
function extOf(url: string): string {
  const m = url.split('?')[0].match(/\.([a-z0-9]+)$/i);
  return (m ? m[1] : 'png').toLowerCase();
}
async function fetchBuf(url: string): Promise<Buffer | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return Buffer.from(await r.arrayBuffer());
  } catch { return null; }
}

// Recolour a transparent logo to a solid colour silhouette (white/ink/accent),
// preserving the original alpha shape. Works for PNG/SVG/WebP sources.
async function recolor(src: Buffer, hex: string, size = 1200): Promise<Buffer | null> {
  try {
    const { r, g, b } = hexToRgb(hex);
    const base = sharp(src, { density: 384 }).resize({ width: size, height: size, fit: 'inside', withoutEnlargement: false }).ensureAlpha();
    const meta = await base.metadata();
    const w = meta.width || size, h = meta.height || size;
    const alpha = await base.clone().extractChannel(3).toColourspace('b-w').toBuffer();
    return await sharp({ create: { width: w, height: h, channels: 3, background: { r, g, b } } })
      .joinChannel(alpha).png().toBuffer();
  } catch { return null; }
}

function guidelinesMd(name: string, doc: ReturnType<typeof toDoc>): string {
  if (!doc) return `# ${name}\n`;
  const c = doc.content;
  const pal = (doc.colors || []).map((x) => `| ${x.label || x.hex} | ${x.hex} |`).join('\n');
  return `# ${name} — Brand Guidelines v1.0

> ${doc.tagline || ''}

## The idea
${c.about_statement || ''}

${c.intro?.[0] || ''}

${c.intro?.[1] || ''}

## Logo
${c.logomark?.[0] || ''}

Always reproduce from the master files. Never recreate, retype, or redraw.
- White (reversed) on ink or dark imagery.
- Black (positive) on cream and light fields.
- Accent variant for premium moments only.

### Clear space & minimum size
${c.clear_space || ''}

### Misuse
${(doc.donts || []).map((d) => `- ${d.replace(/^(do not|don't|never)\s+/i, 'Never ')}`).join('\n')}

## Colour
${c.color_intro || ''}

| Name | HEX |
|------|-----|
| Ink | #0A0908 |
| Cream | #F0ECE4 |
| Pure White | #FFFFFF |
${pal}

## Typography
${c.typeface_intro || ''}

- Display: ${doc.fonts.display.family}
- Text: ${doc.fonts.text.family}
- Functional: ${doc.fonts.mono.family}

---
*${name} · Brand Book v1.0 · Identity by GRAPPES.*
`;
}

export const GET: APIRoute = async ({ locals, params, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!checkRateLimit(`brandbook-zip:${user.id}`, 6, 60_000)) {
    return json({ error: 'Slow down, try again in a moment.' }, 429);
  }

  const row = await loadBrandBook(params.id as string, user.id);
  const doc = row && toDoc(row);
  if (!row || !doc) return json({ error: 'Brand book not found.' }, 404);
  doc.logoHasAlpha = await logoHasTransparency(doc.logoUrl);

  const only = url.searchParams.get('only'); // 'logos' | 'fonts' | null
  const zip = new JSZip();
  const base = slugify(doc.name);

  // ── Logos ──────────────────────────────────────────────────────────────────
  if (!only || only === 'logos') {
    const logos = zip.folder('logos')!;
    const marks: Array<{ key: string; src: string }> = [{ key: 'logo', src: doc.logoUrl }];
    if (doc.symbolUrl) marks.push({ key: 'symbol', src: doc.symbolUrl });
    if (doc.badgeUrl) marks.push({ key: 'badge', src: doc.badgeUrl });
    const accent = (doc.colors.find((c) => c.hex)?.hex) || '#C4A265';
    const variants: Array<{ name: string; hex: string }> = [
      { name: 'white', hex: '#FFFFFF' }, { name: 'black', hex: '#0A0908' }, { name: 'accent', hex: accent },
    ];
    for (const m of marks) {
      const buf = await fetchBuf(m.src);
      if (!buf) continue;
      const ext = extOf(m.src);
      logos.file(`${base}-${m.key}-original.${ext}`, buf); // master (true colours)
      if (ext === 'svg') logos.file(`${base}-${m.key}.svg`, buf);
      // Recolours only make sense for a transparent mark; an opaque source would
      // fill into a solid block, so we ship only the original for those.
      if (await logoHasTransparency(m.src)) {
        for (const v of variants) {
          const png = await recolor(buf, v.hex);
          if (png) logos.file(`${base}-${m.key}-${v.name}.png`, png);
        }
      }
    }
  }

  // ── Fonts ──────────────────────────────────────────────────────────────────
  if (!only || only === 'fonts') {
    const fonts = zip.folder('fonts')!;
    const notes: string[] = ['Brand fonts', ''];
    for (const role of ['display', 'text', 'mono'] as const) {
      const f = doc.fonts[role];
      if (f.url) {
        const buf = await fetchBuf(f.url);
        if (buf) { fonts.file(`${role}-${slugify(f.family)}.${extOf(f.url)}`, buf); notes.push(`${role}: ${f.family} (custom, included)`); }
      } else {
        notes.push(`${role}: ${f.family} (Google Fonts — https://fonts.google.com/specimen/${f.family.replace(/\s+/g, '+')})`);
      }
    }
    fonts.file('FONTS.txt', notes.join('\n') + '\n');
  }

  // ── Book + written guidelines (full pack only) ───────────────────────────────
  if (!only) {
    zip.file('brand-book.html', renderAllOneHTML({ ...doc, downloads: undefined }));
    zip.file('brand-guidelines.md', guidelinesMd(doc.name, doc));
    zip.file('README.txt', `${doc.name} — Brand Book v1.0\n\nOpen brand-book.html in a browser for the full visual brand book.\nlogos/ holds every mark in original + white/black/accent.\nfonts/ holds the brand fonts (or links to the Google families).\n\nIdentity by GRAPPES.\n`);
  }

  const content = await zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const suffix = only ? `-${only}` : '';
  return new Response(content as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Disposition': `attachment; filename="${base}-brand-pack${suffix}.zip"`,
      'Cache-Control': 'no-store',
    },
  });
};
