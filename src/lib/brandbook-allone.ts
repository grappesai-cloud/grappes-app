// ── Brand Book Lab: the single premium template ───────────────────────────────
// A dark, editorial, scrolling brand book modelled on the ALL ONE RECORDS book.
// Replaces the old 4 paginated variants. Same HTML feeds the in-app viewer
// (iframe), the PDF export and the downloadable asset pack.
//
// Logo system: ONE uploaded logo yields the whole system. White/ink variants are
// the original mark with a CSS `filter` (brightness/invert) — this works
// cross-origin (the logo lives on R2, a different host) where CSS `mask` would be
// blocked by CORS. The accent/gold variant is produced server-side (sharp) for
// the downloadable pack; on-page we show the original full-colour mark.
//
// Three type roles (display/text/mono); each a Google font or an uploaded face.
// Applications are generic-adaptive (card, avatar, signage, merch, packaging,
// watermark), not music-specific.

import type { BrandBookContent } from './brandbook-gen';

export interface BrandFont {
  family: string;
  url?: string;
  format?: string;
}

export interface AllOneDoc {
  name: string;
  tagline: string;
  headline?: string;
  industry?: string;
  foundedBy?: string;
  logoUrl: string;
  symbolUrl?: string;
  badgeUrl?: string;
  logoIsLight: boolean;
  /** True when the logo has a real alpha channel (can be recoloured white/ink).
   *  When false, the mark is opaque and shown as supplied. Defaults to true. */
  logoHasAlpha?: boolean;
  colors: Array<{ hex: string; label?: string }>;
  fonts: { display: BrandFont; text: BrandFont; mono: BrandFont };
  donts: string[];
  content: BrandBookContent;
  downloads?: { all?: string; logos?: string; fonts?: string };
}

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = (hex || '').replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(v.slice(0, 2), 16) || 0, g: parseInt(v.slice(2, 4), 16) || 0, b: parseInt(v.slice(4, 6), 16) || 0 };
}
function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}
function rgbStr(hex: string): string {
  const { r, g, b } = hexToRgb(hex);
  return `${r} ${g} ${b}`;
}
function fontFormat(url: string): string {
  if (/\.woff2(\?|$)/i.test(url)) return 'woff2';
  if (/\.woff(\?|$)/i.test(url)) return 'woff';
  if (/\.ttf(\?|$)/i.test(url)) return 'truetype';
  if (/\.otf(\?|$)/i.test(url)) return 'opentype';
  return 'woff2';
}

// Logo variants via CSS filter (cross-origin safe, no CORS / no pixel read).
const FILTER: Record<string, string> = {
  white: 'brightness(0) invert(1)',
  ink: 'brightness(0)',
  original: '',
};
function mark(url: string, variant: 'white' | 'ink' | 'original', cls = '', extra = ''): string {
  const f = FILTER[variant] || '';
  const style = `${f ? `filter:${f};` : ''}${extra}`;
  return `<img class="mk ${cls}" src="${esc(url)}" alt=""${style ? ` style="${style}"` : ''}>`;
}

// ── the renderer ──────────────────────────────────────────────────────────────

export function renderAllOneHTML(doc: AllOneDoc): string {
  const c = doc.content;
  const pal = (doc.colors || []).filter((x) => x && /^#?[0-9a-fA-F]{3,6}$/.test(x.hex || ''))
    .map((x) => ({ hex: x.hex.startsWith('#') ? x.hex : '#' + x.hex, label: x.label }));

  const darkest = pal.slice().sort((a, b) => luminance(a.hex) - luminance(b.hex))[0];
  const ink = darkest && luminance(darkest.hex) < 0.12 ? darkest.hex : '#0A0908';
  const cream = '#F0ECE4';
  // Honour the user's chosen palette: the accent IS their first colour and the
  // spark their second, in the order they picked them — no filtering, no
  // swapping for a default. Only fall back to a neutral gold when no colours
  // were chosen at all.
  const accent = pal[0]?.hex || '#C4A265';
  const spark = pal[1]?.hex || accent;
  // Colour that reads on top of the accent (light accent → ink text/mark, dark
  // accent → white), so a chosen colour works whether it's light or dark.
  const accentIsLight = luminance(accent) > 0.6;
  const onAccent = accentIsLight ? ink : '#FFFFFF';
  const accentMark: 'white' | 'ink' = accentIsLight ? 'ink' : 'white';

  const symbol = doc.symbolUrl || doc.logoUrl;
  const badge = doc.badgeUrl;

  // Opaque logos (no alpha) can't be recoloured — a white/ink filter would fill
  // the whole bounding box. Show them as supplied instead. `mk()` is `mark()`
  // with that fallback baked in; the renderer uses it everywhere downstream.
  const opaque = doc.logoHasAlpha === false;
  const mk = (url: string, variant: 'white' | 'ink' | 'original', cls = '', extra = ''): string =>
    mark(url, opaque ? 'original' : variant, cls, extra);

  const fontFaces = (['display', 'text', 'mono'] as const)
    .map((role) => {
      const f = doc.fonts[role];
      if (!f?.url) return '';
      const fmt = f.format && /^(woff2|woff|truetype|opentype)$/.test(f.format) ? f.format : fontFormat(f.url);
      return `@font-face{font-family:'BB-${role}';src:url('${esc(f.url)}') format('${fmt}');font-display:swap;font-weight:100 900}`;
    })
    .filter(Boolean).join('\n');

  const fam = (role: 'display' | 'text' | 'mono', fallback: string): string => {
    const f = doc.fonts[role];
    if (f?.url) return `'BB-${role}', ${fallback}`;
    return `'${f?.family || ''}', ${fallback}`;
  };

  const googleFamilies = (['display', 'text', 'mono'] as const)
    .map((role) => doc.fonts[role])
    .filter((f) => f && !f.url && f.family)
    .map((f) => f!.family.trim().replace(/\s+/g, '+'))
    .filter((v, i, a) => a.indexOf(v) === i);
  const googleLink = googleFamilies.length
    ? `<link href="https://fonts.googleapis.com/css2?${googleFamilies.map((f) => `family=${f}:wght@300;400;500;600;700`).join('&')}&display=swap" rel="stylesheet">`
    : '';

  const donts = (doc.donts && doc.donts.length ? doc.donts : [
    'Stretch, condense, or distort the proportions',
    'Rotate or set the logo on an angle',
    'Add gradients, shadows, strokes, or bevels',
    'Recolour the mark outside the approved palette',
    'Place the logo on a busy, low-contrast background',
    'Recreate the wordmark in another typeface',
  ]).slice(0, 6);
  const dontIcons = ['↔', '◴', '▦', '◐', '▤', 'Aa'];

  const css = `
${fontFaces}
:root{
  --ink:${ink}; --cream:${cream}; --white:#fff;
  --grey:#8C8C8C; --line:rgba(255,255,255,.12);
  --accent:${accent}; --spark:${spark}; --accent-rgb:${rgbStr(accent)}; --on-accent:${onAccent};
  --disp:${fam('display', "'Space Grotesk',sans-serif")};
  --body:${fam('text', "'Inter',sans-serif")};
  --mono:${fam('mono', "'Space Mono',monospace")};
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--ink);color:var(--white);font-family:var(--body);font-weight:300;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wrap{max-width:1140px;margin:0 auto;padding:0 56px}
section{padding:116px 0;border-top:1px solid var(--line)}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:var(--grey);margin-bottom:26px;display:flex;align-items:center;gap:14px}
.eyebrow::before{content:"";width:34px;height:1px;background:var(--grey)}
h1,h2,h3{font-family:var(--disp);font-weight:500;line-height:1.05;letter-spacing:-.02em}
h2{font-size:clamp(34px,5vw,62px);margin-bottom:26px}
h3{font-size:22px;letter-spacing:0;margin-bottom:12px}
p{max-width:64ch;color:#cfcfcf}
p.lead{font-size:20px;color:#ececec;font-weight:300}
.caps{text-transform:uppercase;letter-spacing:.24em;font-family:var(--mono);font-size:11px;color:var(--grey)}
.mono{font-family:var(--mono)}
.mk{display:block;max-width:100%;max-height:100%;object-fit:contain}

nav{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:18px 56px;backdrop-filter:blur(14px);background:rgba(10,10,10,.6);border-bottom:1px solid var(--line)}
nav .brand{font-family:var(--mono);font-size:12px;letter-spacing:.3em;text-transform:uppercase}
nav .links{display:flex;gap:26px}
nav .links a{font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--grey);text-decoration:none}
nav .links a:hover{color:#fff}
@media(max-width:820px){nav .links{display:none}.wrap{padding:0 28px}nav{padding:16px 28px}}

.hero{min-height:88vh;display:flex;flex-direction:column;justify-content:center;align-items:center;text-align:center;padding:140px 0 90px;border-top:none}
.hero .mk{height:150px;max-width:80%;width:auto;margin:0 auto 46px}
.hero .tag{font-family:var(--disp);font-size:clamp(20px,2.4vw,30px);font-weight:300;color:#fff}
.hero .meta{display:flex;gap:42px;flex-wrap:wrap;justify-content:center;margin-top:48px;font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--grey)}
.hero .meta b{color:#fff;font-weight:400;display:block;margin-top:6px;letter-spacing:.16em}

.two-col{display:grid;grid-template-columns:.85fr 1.15fr;gap:56px;align-items:start}
@media(max-width:820px){.two-col{grid-template-columns:1fr;gap:26px}}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:22px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:20px}
@media(max-width:820px){.grid2,.grid3{grid-template-columns:1fr}}

.plate{border:1px solid var(--line);border-radius:6px;display:flex;align-items:center;justify-content:center;padding:50px;min-height:230px}
.plate.dark{background:var(--ink)} .plate.light{background:var(--cream)}
.plate .mk{max-height:110px;max-width:72%}
.plate.sq .mk{max-height:140px;max-width:56%}
.label-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:13px}
.ring{width:168px;height:168px;border-radius:50%;display:flex;align-items:center;justify-content:center;border:2px solid #fff}
.ring .mk{max-width:62%;max-height:56px}

.constr{background:#111;border:1px solid var(--line);border-radius:6px;padding:46px;position:relative;min-height:230px;display:flex;align-items:center;justify-content:center}
.constr .mk{max-width:60%;max-height:90px;position:relative;z-index:2}
.ruler{position:absolute;inset:46px;border:1px dashed rgba(var(--accent-rgb),.5);z-index:1}
ul.clean{list-style:none;margin-top:6px}
ul.clean li{padding:12px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;font-size:15px;color:#d4d4d4}
ul.clean li .mono{color:var(--grey);font-size:12px;text-align:right;white-space:nowrap}

.dont{border:1px solid var(--line);border-radius:6px;padding:26px;min-height:160px;display:flex;flex-direction:column;justify-content:space-between}
.dont .x{font-family:var(--disp);font-size:28px;color:#ff5252;margin-bottom:auto}
.dont p{font-size:14px;color:#bcbcbc}

.swatch{border-radius:6px;overflow:hidden;border:1px solid var(--line)}
.swatch .chip{height:140px} .swatch .info{padding:15px 17px;background:#0e0e0e}
.swatch .info .n{font-family:var(--disp);font-size:15px;font-weight:500}
.swatch .info .v{font-family:var(--mono);font-size:11px;color:var(--grey);margin-top:5px}

.typeblock{border:1px solid var(--line);border-radius:6px;padding:32px;margin-bottom:16px}
.typeblock .name{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px}
.glyphs{color:var(--grey);margin-top:14px;font-size:15px}

.app{border:1px solid var(--line);border-radius:6px;overflow:hidden;background:#0e0e0e}
.app .canvas{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden;padding:18%}
.app .canvas .mk{max-width:100%;max-height:100%}
.app .cap{padding:13px 17px;font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--grey);border-top:1px solid var(--line)}
.card{width:84%;aspect-ratio:1.62/1;background:var(--ink);border:1px solid var(--line);border-radius:8px;display:flex;flex-direction:column;justify-content:space-between;padding:20px}
.card .mk{max-width:48%;max-height:26px;margin:0}
.card .ln{font-family:var(--mono);font-size:9px;letter-spacing:.16em;color:var(--grey)}
.tee{position:absolute;inset:0;background:var(--cream);display:flex;align-items:center;justify-content:center}
.tee .mk{max-width:46%;max-height:62px}
.pack{width:78%;aspect-ratio:1/1.08;background:#141312;border:1px solid var(--line);border-radius:7px;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.pack .stripe{position:absolute;left:0;right:0;bottom:24%;height:8px;background:var(--accent)}
.pack .mk{max-width:52%;max-height:46px;z-index:2}

footer{padding:88px 0 64px;border-top:1px solid var(--line);text-align:center}
footer .mk{height:50px;width:auto;margin:0 auto 26px}
footer .caps{justify-content:center}

.dl-hero{display:flex;flex-wrap:wrap;gap:13px;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:9px;padding:16px 24px;border:1px solid var(--line);border-radius:6px;font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#fff;text-decoration:none;background:#0e0d0c}
.btn:hover{background:#fff;color:var(--ink)}
.btn.primary{background:var(--accent);color:var(--on-accent);border-color:var(--accent)}

/* PDF / print: the hero uses min-height 88vh for the on-screen viewer. In print
   media vh resolves against the (very tall) PDF page height, so the hero would
   balloon to fill the whole document and push everything off the page. Collapse
   it to content height and make the nav non-sticky for the export. */
@media print {
  .hero{min-height:0 !important;padding:80px 0 64px !important}
  nav{position:static !important}
  body{overflow:visible !important}
}`;

  const meta = [
    `<span>Identity<b>${esc(doc.industry || 'Brand')}</b></span>`,
    doc.foundedBy ? `<span>Founded by<b>${esc(doc.foundedBy)}</b></span>` : '',
    doc.industry ? `<span>Industry<b>${esc(doc.industry)}</b></span>` : '',
    `<span>Document<b>Brand Book v1.0</b></span>`,
  ].filter(Boolean).join('');

  const groundSwatches = [
    { hex: ink, n: 'Ink', v: `${ink.toUpperCase()} · the ground` },
    { hex: cream, n: 'Cream', v: `${cream.toUpperCase()} · light field` },
    { hex: '#FFFFFF', n: 'Pure White', v: '#FFFFFF · the reversed mark' },
  ].map((s) => `<div class="swatch"><div class="chip" style="background:${s.hex}"></div><div class="info"><div class="n">${esc(s.n)}</div><div class="v">${esc(s.v)}</div></div></div>`).join('');
  const sigSwatches = pal.length
    ? pal.map((s) => `<div class="swatch"><div class="chip" style="background:${s.hex}"></div><div class="info"><div class="n">${esc(s.label || s.hex.toUpperCase())}</div><div class="v">${esc(s.hex.toUpperCase())}</div></div></div>`).join('')
    : '';

  const apps = `
  <div class="app"><div class="canvas" style="padding:14%"><div class="card">${mk(doc.logoUrl, 'white')}<div><div class="ln">${esc(doc.name.toUpperCase())}</div>${doc.industry ? `<div class="ln" style="margin-top:4px">${esc(doc.industry)}</div>` : ''}</div></div></div><div class="cap">Business card</div></div>
  <div class="app"><div class="canvas" style="background:var(--ink)">${mk(symbol, 'white')}</div><div class="cap">Social avatar</div></div>
  <div class="app"><div class="canvas" style="background:#0d0d0d">${mk(doc.logoUrl, 'white')}</div><div class="cap">Signage</div></div>
  <div class="app"><div class="canvas" style="padding:0"><div class="tee">${mk(doc.logoUrl, 'ink')}</div></div><div class="cap">Merch · positive print</div></div>
  <div class="app"><div class="canvas"><div class="pack"><div class="stripe"></div>${mk(doc.logoUrl, 'white')}</div></div><div class="cap">Packaging</div></div>
  <div class="app"><div class="canvas" style="background:var(--ink)">${mk(symbol, 'white', '', 'opacity:.16')}</div><div class="cap">Watermark</div></div>`;

  const downloads = doc.downloads ? `
<section id="downloads">
  <div class="wrap">
    <div class="eyebrow">— Downloads</div>
    <h2>Take it with you</h2>
    <p style="margin-bottom:24px">Every mark in SVG and PNG (white, black and accent), the brand fonts, and the written guidelines. Grab the full pack or pick what you need.</p>
    <div class="dl-hero">
      ${doc.downloads.all ? `<a class="btn primary" href="${esc(doc.downloads.all)}">↓ Download everything · ZIP</a>` : ''}
      ${doc.downloads.logos ? `<a class="btn" href="${esc(doc.downloads.logos)}">↓ Logos · SVG + PNG</a>` : ''}
      ${doc.downloads.fonts ? `<a class="btn" href="${esc(doc.downloads.fonts)}">↓ Fonts</a>` : ''}
    </div>
  </div>
</section>` : '';

  const body = `
<nav>
  <div class="brand">${esc(doc.name)}</div>
  <div class="links"><a href="#logo">Logo</a><a href="#colour">Colour</a><a href="#type">Type</a><a href="#apps">Applications</a>${doc.downloads ? '<a href="#downloads">Downloads</a>' : ''}</div>
  <div class="brand mono">Brand Book · v1.0</div>
</nav>

<header class="hero wrap">
  ${mk(doc.logoUrl, 'white', '', '')}
  <div class="tag">${esc(doc.tagline || '')}</div>
  <div class="meta">${meta}</div>
</header>

<section id="about">
  <div class="wrap two-col">
    <div><div class="eyebrow">01 — The idea</div><h2>${esc(doc.headline || doc.name)}</h2></div>
    <div>
      <p class="lead">${esc(c.about_statement || c.intro?.[0] || '')}</p>
      ${c.intro?.[0] ? `<p style="margin-top:22px">${esc(c.intro[0])}</p>` : ''}
      ${c.intro?.[1] ? `<p style="margin-top:22px">${esc(c.intro[1])}</p>` : ''}
      ${c.aim_statement ? `<p style="margin-top:22px;color:var(--accent)">${esc(c.aim_statement)}</p>` : ''}
    </div>
  </div>
</section>

<section id="logo">
  <div class="wrap">
    <div class="eyebrow">02 — The marks</div>
    <h2>The logo system</h2>
    <p style="margin-bottom:${opaque ? '20px' : '42px'}">${esc(c.logomark?.[0] || 'One family of marks. Always reproduce from the master files. Never recreate, retype, or redraw.')}</p>
    ${opaque ? `<p class="caps" style="display:flex;align-items:center;gap:10px;margin-bottom:34px;color:var(--accent);text-transform:none;letter-spacing:.02em;font-size:13px"><span style="font-family:var(--disp)">⚠</span> Shown as supplied. Upload a transparent PNG or SVG to unlock the reversed and single-colour variants.</p>` : ''}
    <div class="grid2" style="margin-bottom:22px">
      <div><div class="plate dark">${mk(doc.logoUrl, 'white')}</div><div class="label-row"><span class="caps">${opaque ? 'Primary' : 'Primary · reversed'}</span><span class="caps">on ink</span></div></div>
      <div><div class="plate light">${mk(doc.logoUrl, 'ink')}</div><div class="label-row"><span class="caps">${opaque ? 'Primary' : 'Primary · positive'}</span><span class="caps">on cream</span></div></div>
    </div>
    <div class="grid3">
      <div><div class="plate sq" style="background:${accent}">${mk(doc.logoUrl, accentMark)}</div><div class="label-row"><span class="caps">On brand colour</span><span class="caps">accent</span></div></div>
      <div><div class="plate dark sq">${badge ? mark(badge, 'original') : `<div class="ring">${mk(symbol, 'white')}</div>`}</div><div class="label-row"><span class="caps">Badge</span><span class="caps">avatars</span></div></div>
      <div><div class="plate dark sq">${mk(symbol, 'white')}</div><div class="label-row"><span class="caps">Symbol</span><span class="caps">app · favicon</span></div></div>
    </div>
  </div>
</section>

<section id="space">
  <div class="wrap">
    <div class="eyebrow">03 — Space & scale</div>
    <h2>Give it air</h2>
    <div class="grid2" style="margin-top:34px;align-items:start">
      <div class="constr"><div class="ruler"></div>${mk(doc.logoUrl, 'white')}</div>
      <div>
        <h3>Clear space</h3>
        <p>${esc(c.clear_space || 'Keep a clear margin around the logo on all four sides equal to the height of the mark. Nothing enters this zone.')}</p>
        <h3 style="margin-top:26px">Minimum size</h3>
        <ul class="clean">
          <li>Primary lockup — digital <span class="mono">≥ 180 px wide</span></li>
          <li>Primary lockup — print <span class="mono">≥ 40 mm wide</span></li>
          <li>Badge / symbol <span class="mono">≥ 32 px</span></li>
        </ul>
        <h3 style="margin-top:26px">Backgrounds</h3>
        <p>${esc(c.combinations || 'White (reversed) on ink or dark imagery. Ink (positive) on cream and light fields. Never place the logo on a busy mid-tone background without a scrim.')}</p>
      </div>
    </div>
  </div>
</section>

<section id="misuse">
  <div class="wrap">
    <div class="eyebrow">04 — Misuse</div>
    <h2>Never do this</h2>
    <div class="grid3" style="margin-top:34px">
      ${donts.map((d, i) => {
        const t = d.replace(/^(do not|don't|never)\s+/i, '');
        const txt = t.charAt(0).toUpperCase() + t.slice(1);
        return `<div class="dont"><div class="x">${dontIcons[i] || '×'}</div><p>${esc(txt)}</p></div>`;
      }).join('')}
    </div>
  </div>
</section>

<section id="colour">
  <div class="wrap">
    <div class="eyebrow">05 — Colour</div>
    <h2>The palette</h2>
    <p style="margin-bottom:38px">${esc(c.color_intro || (sigSwatches ? 'These are the brand colours. They carry the identity across every surface; the near-black and cream below are the neutral grounds they sit on.' : 'A near-black ink and a warm cream form the ground; the mark stays monochrome on top.'))}</p>
    ${sigSwatches ? `<div class="caps" style="margin-bottom:16px">Brand colours</div><div class="grid3" style="margin-bottom:50px">${sigSwatches}</div>` : ''}
    <div class="caps" style="margin-bottom:16px">Neutrals</div>
    <div class="grid3">${groundSwatches}</div>
  </div>
</section>

<section id="type">
  <div class="wrap">
    <div class="eyebrow">06 — Typography</div>
    <h2>Engineered & quiet</h2>
    <p style="margin-bottom:38px">${esc(c.typeface_intro || 'A tight system: a display face for headlines, a neutral sans for reading, and a monospace for the functional voice of the brand.')}</p>
    <div class="typeblock">
      <div class="name"><div style="font-family:var(--disp);font-size:48px;font-weight:500">${esc(doc.fonts.display.family || 'Display')}</div><span class="caps">Display</span></div>
      <div style="font-family:var(--disp);font-size:30px;font-weight:300">Headlines, titles, names.</div>
      <div class="glyphs" style="font-family:var(--disp)">AaBbCcDd 0123456789</div>
    </div>
    <div class="typeblock">
      <div class="name"><div style="font-family:var(--body);font-size:32px;font-weight:500">${esc(doc.fonts.text.family || 'Text')}</div><span class="caps">Text</span></div>
      <div style="font-family:var(--body);font-size:21px">Body copy, descriptions, and interface. Set light to regular, generous leading.</div>
      <div class="glyphs" style="font-family:var(--body)">AaBbCcDd 0123456789</div>
    </div>
    <div class="typeblock">
      <div class="name"><div style="font-family:var(--mono);font-size:28px">${esc(doc.fonts.mono.family || 'Mono')}</div><span class="caps">Functional</span></div>
      <div style="font-family:var(--mono);font-size:20px;letter-spacing:.04em">${esc(doc.name.toUpperCase())} · 2026 · ${esc((doc.industry || 'BRAND').toUpperCase())}</div>
      <div class="glyphs" style="font-family:var(--mono)">Set in caps, tracked — labels, data, captions.</div>
    </div>
  </div>
</section>

<section id="apps">
  <div class="wrap">
    <div class="eyebrow">07 — In the world</div>
    <h2>Applications</h2>
    <div class="grid3" style="margin-top:34px">${apps}</div>
  </div>
</section>

${downloads}

<footer>
  ${mk(symbol, 'white')}
  <div class="caps">${esc(doc.name)} · Brand Book v1.0${doc.tagline ? ' · ' + esc(doc.tagline) : ''}</div>
  <div class="caps" style="margin-top:10px;color:#555">Identity by GRAPPES</div>
</footer>`;

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(doc.name)} — Brand Book</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${googleLink}
<style>${css}</style>
</head><body>${body}</body></html>`;
}
