// One-off: generate the Grappes brand book for ALL templates and save PDFs to
// the Desktop. Runs the real pipeline (logo analysis → website context → Claude
// copy → render → PDF) locally, no auth needed.
// Run: npx tsx scripts/gen-grappes-brandbook.mts

import { readFileSync } from 'node:fs';
import puppeteer from 'puppeteer';
import sharp from 'sharp';

// ── load ANTHROPIC_API_KEY from .env before importing modules that read it ────
for (const line of readFileSync('.env', 'utf8').split('\n')) {
  const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
  if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
}

const { generateBrandBookContent, DEFAULT_DONTS } = await import('../src/lib/brandbook-gen.ts');
const { renderBrandBookHTML } = await import('../src/lib/brandbook-template.ts');
const { renderAkriviHTML } = await import('../src/lib/brandbook-akrivi.ts');
const { fetchWebsiteContext } = await import('../src/lib/website-context.ts');

// ── logo → data URL ───────────────────────────────────────────────────────────
const LOGO_PATH = '/Users/alexandrucojanu/Downloads/logo (1).png';
const logoB64 = readFileSync(LOGO_PATH).toString('base64');
const logoUrl = `data:image/png;base64,${logoB64}`;

// ── analyze logo with sharp: tone + dominant palette (same logic as wizard) ───
const SIZE = 72;
const { data } = await sharp(LOGO_PATH).resize(SIZE, SIZE, { fit: 'fill' }).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
let sum = 0, n = 0;
const buckets = new Map<string, any>();
for (let i = 0; i < data.length; i += 4) {
  if (data[i + 3] < 140) continue;
  const r = data[i], g = data[i + 1], b = data[i + 2];
  sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; n++;
  const key = `${r >> 4}-${g >> 4}-${b >> 4}`;
  const cur = buckets.get(key) || { c: 0, r: 0, g: 0, b: 0 };
  cur.c++; cur.r += r; cur.g += g; cur.b += b; buckets.set(key, cur);
}
const all = [...buckets.values()].map((x) => ({ c: x.c, r: x.r / x.c, g: x.g / x.c, b: x.b / x.c })).sort((p, q) => q.c - p.c);
const lum = (c: any) => (0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b) / 255;
const dist = (p: any, q: any) => Math.abs(p.r - q.r) + Math.abs(p.g - q.g) + Math.abs(p.b - q.b);
let pool = all.filter((x) => lum(x) > 0.06 && lum(x) < 0.94);
if (!pool.length) pool = all;
const picked: any[] = [];
for (const x of pool) { if (picked.some((p) => dist(p, x) < 90)) continue; picked.push(x); if (picked.length === 3) break; }
// Order by "brand vividness" so the saturated mid-tone (not a pale tint) leads.
const vivid = (c: any) => {
  const mx = Math.max(c.r, c.g, c.b) / 255, mn = Math.min(c.r, c.g, c.b) / 255;
  const sat = mx === 0 ? 0 : (mx - mn) / mx, L = lum(c);
  return sat - Math.max(0, L - 0.72) * 1.2 - Math.max(0, 0.18 - L) * 1.2;
};
picked.sort((a, b) => vivid(b) - vivid(a));
const hx = (v: number) => Math.round(v).toString(16).padStart(2, '0');
const isLight = n ? sum / n > 0.5 : true;
const palette = picked.map((p) => '#' + hx(p.r) + hx(p.g) + hx(p.b));
console.log('logo isLight:', isLight, 'palette:', palette);

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });

// ── website context ───────────────────────────────────────────────────────────
const website = await fetchWebsiteContext('https://grappes.dev');
console.log('website context:', website ? `${website.title} (${website.text.length} chars)` : 'none');

// ── brand inputs ──────────────────────────────────────────────────────────────
const labels = ['Grappes Purple', 'Electric Violet', 'Soft Magenta'];
const colors = palette.length
  ? palette.map((hex, i) => ({ hex, label: labels[i] || `Brand Color ${i + 1}` }))
  : [{ hex: '#8835e8', label: 'Grappes Purple' }, { hex: '#c75afb', label: 'Electric Violet' }];

const content = await generateBrandBookContent({
  name: 'Grappes',
  about: 'Grappes is a white-label AI creative platform for agencies and studios. One engine resells award-grade websites, AI reel analysis, SEO audits, logos and brand books under the agency\'s own brand and pricing.',
  industry: 'AI creative software / agency tooling',
  values: ['Innovation', 'Craftsmanship', 'White-label', 'Speed'],
  voiceKeywords: ['Confident', 'Technical', 'Direct', 'Premium'],
  colors,
  typeface: 'Inter',
  logoUrl,
  website,
});
console.log('copy generated, tagline:', content.tagline);

const baseDoc = { name: 'Grappes', logoUrl, typeface: 'Inter', colors, donts: DEFAULT_DONTS, content, logoIsLight: isLight };

// ── render each template to PDF ───────────────────────────────────────────────
const templates: Array<{ key: string; w: number; h: number; html: string }> = [
  { key: 'editorial', w: 1200, h: 900, html: renderBrandBookHTML(baseDoc as any) },
  { key: 'corporate', w: 1280, h: 720, html: renderAkriviHTML(baseDoc as any, 'corporate') },
  { key: 'urban', w: 1280, h: 720, html: renderAkriviHTML(baseDoc as any, 'urban') },
  { key: 'contemporary', w: 1280, h: 720, html: renderAkriviHTML(baseDoc as any, 'contemporary') },
];

for (const t of templates) {
  const page = await browser.newPage();
  await page.setViewport({ width: t.w, height: t.h });
  await page.setContent(t.html, { waitUntil: 'networkidle0', timeout: 60_000 });
  await page.evaluate(() => (document as any).fonts.ready);
  const out = `/Users/alexandrucojanu/Desktop/Grappes-BrandBook-${t.key}.pdf`;
  await page.pdf({ path: out, printBackground: true, preferCSSPageSize: true });
  // QA screenshots of a few pages
  const { mkdirSync } = await import('node:fs');
  mkdirSync(`/tmp/grappes-bb/${t.key}`, { recursive: true });
  const els = await page.$$('.page');
  for (const idx of [0, 8, 9, t.key === 'editorial' ? 14 : 12]) {
    if (els[idx]) await els[idx].screenshot({ path: `/tmp/grappes-bb/${t.key}/p${String(idx + 1).padStart(2, '0')}.png` });
  }
  await page.close();
  console.log('saved', out);
}

await browser.close();
console.log('done');
