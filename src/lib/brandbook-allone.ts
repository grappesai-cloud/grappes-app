// ── Brand Book Lab: the single premium template ───────────────────────────────
// A dark, editorial, scrolling brand book modelled on the ALL ONE RECORDS book.
// Replaces the old 4 paginated variants. Same HTML feeds the in-app viewer
// (iframe), the PDF export and the downloadable asset pack.
//
// Design system:
//  - Three type roles (display / text / mono); each can be a Google font OR a
//    user-uploaded font file (@font-face).
//  - One uploaded primary logo; white / black / accent variants are rendered as
//    CSS-masked silhouettes so a single mark yields the whole system. An optional
//    uploaded symbol/badge overrides the silhouette where provided.
//  - Ground = ink + cream + white; signature = the brand's palette colours.
//  - Applications are generic-adaptive (card, avatar, signage, merch, packaging,
//    watermark), not music-specific.

import type { BrandBookContent } from './brandbook-gen';

export interface BrandFont {
  family: string;   // Google family name OR a label for the custom face
  url?: string;     // when set, an uploaded font file → @font-face src
  format?: string;  // woff2 | woff | truetype (derived from url if omitted)
}

export interface AllOneDoc {
  name: string;
  tagline: string;
  headline?: string;          // short 2-4 word manifesto headline (optional)
  industry?: string;
  foundedBy?: string;
  logoUrl: string;            // primary mark (original, full colour)
  symbolUrl?: string;         // optional uploaded symbol/icon; else silhouette of logo
  badgeUrl?: string;          // optional uploaded badge; else logo inside a ring
  logoIsLight: boolean;       // true = light mark (sits on dark)
  colors: Array<{ hex: string; label?: string }>; // signature palette (1-4)
  fonts: { display: BrandFont; text: BrandFont; mono: BrandFont };
  donts: string[];
  content: BrandBookContent;
  /** Download URLs; when absent the Downloads section is hidden (e.g. PDF render). */
  downloads?: {
    all?: string; logos?: string; fonts?: string;
  };
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

// A masked silhouette of `url` filled with `color` — yields white/black/accent
// marks from a single uploaded logo without server-side image processing.
function maskMark(url: string, color: string, cls = ''): string {
  const u = esc(url);
  return `<span class="mark ${cls}" style="--m:url('${u}');background:${color}"></span>`;
}

// ── the renderer ──────────────────────────────────────────────────────────────

export function renderAllOneHTML(doc: AllOneDoc): string {
  const c = doc.content;
  const pal = (doc.colors || []).filter((x) => x && /^#?[0-9a-fA-F]{3,6}$/.test(x.hex || ''))
    .map((x) => ({ hex: x.hex.startsWith('#') ? x.hex : '#' + x.hex, label: x.label }));

  // Ground: derive a near-black ink and a warm cream. Prefer the brand's darkest
  // colour for ink if it is genuinely dark, else a neutral carbon.
  const darkest = pal.slice().sort((a, b) => luminance(a.hex) - luminance(b.hex))[0];
  const ink = darkest && luminance(darkest.hex) < 0.12 ? darkest.hex : '#0A0908';
  const cream = '#F0ECE4';

  // Signature = first non-near-black/near-white colour; spark = second.
  const sig = pal.filter((x) => luminance(x.hex) > 0.1 && luminance(x.hex) < 0.95);
  const accent = (sig[0]?.hex) || '#C4A265';
  const spark = (sig[1]?.hex) || accent;

  // Logo system. Original on neutral; silhouettes for the variants.
  const symbol = doc.symbolUrl || doc.logoUrl;
  const badge = doc.badgeUrl;

  // Fonts.
  const fontFaces = (['display', 'text', 'mono'] as const)
    .map((role) => {
      const f = doc.fonts[role];
      if (!f?.url) return '';
      const fmt = f.format || fontFormat(f.url);
      return `@font-face{font-family:'BB-${role}';src:url('${esc(f.url)}') format('${fmt}');font-display:swap;font-weight:100 900}`;
    })
    .filter(Boolean).join('\n');

  const fam = (role: 'display' | 'text' | 'mono', fallback: string): string => {
    const f = doc.fonts[role];
    if (f?.url) return `'BB-${role}', ${fallback}`;
    return `'${f?.family || ''}', ${fallback}`;
  };

  // Google fonts to load for the roles that are NOT custom uploads.
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

  // Signature / spark inline highlight in the manifesto.
  const accentName = sig[0]?.label || 'the signature';
  const sparkName = sig[1]?.label || 'the spark';

  const fh = doc.foundedBy ? `<span>Founded by<b>${esc(doc.foundedBy)}</b></span>` : '';
  const fi = doc.industry ? `<span>Industry<b>${esc(doc.industry)}</b></span>` : '';

  const css = `
${fontFaces}
:root{
  --ink:${ink}; --carbon:${ink}; --cream:${cream}; --white:#fff;
  --grey:#8C8C8C; --line:rgba(255,255,255,.12);
  --accent:${accent}; --spark:${spark};
  --accent-rgb:${rgbStr(accent)};
  --disp:${fam('display', "'Space Grotesk',sans-serif")};
  --body:${fam('text', "'Inter',sans-serif")};
  --mono:${fam('mono', "'Space Mono',monospace")};
}
*{margin:0;padding:0;box-sizing:border-box}
html{scroll-behavior:smooth}
body{background:var(--ink);color:var(--white);font-family:var(--body);font-weight:300;line-height:1.6;-webkit-font-smoothing:antialiased;overflow-x:hidden}
.wrap{max-width:1180px;margin:0 auto;padding:0 40px}
section{padding:120px 0;border-top:1px solid var(--line)}
.eyebrow{font-family:var(--mono);font-size:12px;letter-spacing:.32em;text-transform:uppercase;color:var(--grey);margin-bottom:28px;display:flex;align-items:center;gap:14px}
.eyebrow::before{content:"";width:34px;height:1px;background:var(--grey)}
h1,h2,h3{font-family:var(--disp);font-weight:500;line-height:1.04;letter-spacing:-.02em}
h2{font-size:clamp(34px,5vw,64px);margin-bottom:28px}
h3{font-size:23px;letter-spacing:0;margin-bottom:12px}
p{max-width:62ch;color:#cfcfcf}
p.lead{font-size:20px;color:#ececec;font-weight:300}
.caps{text-transform:uppercase;letter-spacing:.26em;font-family:var(--mono);font-size:11px;color:var(--grey)}
.mono{font-family:var(--mono)}

/* masked marks */
.mark{display:inline-block;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}

nav{position:sticky;top:0;z-index:50;display:flex;justify-content:space-between;align-items:center;padding:18px 40px;backdrop-filter:blur(14px);background:rgba(10,10,10,.6);border-bottom:1px solid var(--line)}
nav .brand{font-family:var(--mono);font-size:12px;letter-spacing:.3em;text-transform:uppercase}
nav .links{display:flex;gap:26px}
nav .links a{font-family:var(--mono);font-size:11px;letter-spacing:.2em;text-transform:uppercase;color:var(--grey);text-decoration:none}
nav .links a:hover{color:#fff}
@media(max-width:820px){nav .links{display:none}}

.hero{min-height:92vh;display:flex;flex-direction:column;justify-content:center;padding:150px 0 90px;border-top:none}
.hero .logo{height:150px;width:min(820px,84%);-webkit-mask:var(--m) left center/contain no-repeat;mask:var(--m) left center/contain no-repeat;background:#fff;margin-bottom:48px}
.hero .tag{font-family:var(--disp);font-size:clamp(20px,2.4vw,30px);font-weight:300;color:#fff}
.hero .meta{display:flex;gap:42px;flex-wrap:wrap;margin-top:50px;font-family:var(--mono);font-size:11px;letter-spacing:.22em;text-transform:uppercase;color:var(--grey)}
.hero .meta b{color:#fff;font-weight:400;display:block;margin-top:6px;letter-spacing:.16em}

.two-col{display:grid;grid-template-columns:.85fr 1.15fr;gap:60px;align-items:start}
@media(max-width:820px){.two-col{grid-template-columns:1fr;gap:28px}}
.grid2{display:grid;grid-template-columns:1fr 1fr;gap:24px}
.grid3{display:grid;grid-template-columns:repeat(3,1fr);gap:22px}
@media(max-width:820px){.grid2,.grid3{grid-template-columns:1fr}}

.plate{border:1px solid var(--line);border-radius:5px;display:flex;align-items:center;justify-content:center;padding:56px;min-height:240px}
.plate.dark{background:var(--ink)}
.plate.light{background:var(--cream)}
.plate .mark{width:70%;height:120px}
.plate.sq .mark{width:54%;height:150px}
.label-row{display:flex;justify-content:space-between;align-items:baseline;margin-top:13px}
.ring{width:170px;height:170px;border-radius:50%;display:flex;align-items:center;justify-content:center}
.ring .mark{width:64%;height:60px}

.constr{background:#111;border:1px solid var(--line);border-radius:5px;padding:48px;position:relative;min-height:230px;display:flex;align-items:center;justify-content:center}
.constr .mark{width:62%;height:90px;position:relative;z-index:2}
.ruler{position:absolute;inset:48px;border:1px dashed rgba(var(--accent-rgb),.45);z-index:1}
ul.clean{list-style:none;margin-top:6px}
ul.clean li{padding:12px 0;border-bottom:1px solid var(--line);display:flex;justify-content:space-between;gap:20px;font-size:15px;color:#d4d4d4}
ul.clean li .mono{color:var(--grey);font-size:12px;text-align:right;white-space:nowrap}

.dont{border:1px solid var(--line);border-radius:5px;padding:26px;min-height:160px;display:flex;flex-direction:column;justify-content:space-between}
.dont .x{font-family:var(--disp);font-size:28px;color:#ff5252;margin-bottom:auto}
.dont p{font-size:14px;color:#bcbcbc}

.swatch{border-radius:5px;overflow:hidden;border:1px solid var(--line)}
.swatch .chip{height:140px}
.swatch .info{padding:15px 17px;background:#0e0e0e}
.swatch .info .n{font-family:var(--disp);font-size:15px;font-weight:500}
.swatch .info .v{font-family:var(--mono);font-size:11px;color:var(--grey);margin-top:5px}

.typeblock{border:1px solid var(--line);border-radius:5px;padding:34px;margin-bottom:16px}
.typeblock .name{display:flex;justify-content:space-between;align-items:baseline;margin-bottom:18px}
.glyphs{color:var(--grey);margin-top:14px;font-size:15px}

.app{border:1px solid var(--line);border-radius:5px;overflow:hidden;background:#0e0e0e}
.app .canvas{aspect-ratio:1/1;display:flex;align-items:center;justify-content:center;position:relative;overflow:hidden}
.app .cap{padding:13px 17px;font-family:var(--mono);font-size:11px;letter-spacing:.18em;text-transform:uppercase;color:var(--grey);border-top:1px solid var(--line)}
.card{width:80%;aspect-ratio:1.62/1;background:var(--ink);border:1px solid var(--line);border-radius:8px;display:flex;flex-direction:column;justify-content:space-between;padding:22px}
.card .mark{width:46%;height:26px;background:#fff;-webkit-mask:var(--m) left center/contain no-repeat;mask:var(--m) left center/contain no-repeat}
.card .ln{font-family:var(--mono);font-size:9px;letter-spacing:.16em;color:var(--grey)}
.tee{width:100%;height:100%;background:var(--cream);display:flex;align-items:center;justify-content:center}
.tee .mark{width:42%;height:60px;background:var(--ink);-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat}
.pack{width:74%;aspect-ratio:1/1.1;background:#141312;border:1px solid var(--line);border-radius:6px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;position:relative}
.pack .stripe{position:absolute;left:0;right:0;bottom:26%;height:8px;background:var(--accent)}
.pack .mark{width:50%;height:46px;background:#fff;-webkit-mask:var(--m) center/contain no-repeat;mask:var(--m) center/contain no-repeat;z-index:2}

footer{padding:90px 0 64px;border-top:1px solid var(--line);text-align:center}
footer .mark{width:110px;height:54px;background:#fff;margin:0 auto 26px;display:block}
footer .caps{justify-content:center}

.dl-hero{display:flex;flex-wrap:wrap;gap:13px;margin-top:8px}
.btn{display:inline-flex;align-items:center;gap:9px;padding:16px 24px;border:1px solid var(--line);border-radius:5px;font-family:var(--mono);font-size:12px;letter-spacing:.14em;text-transform:uppercase;color:#fff;text-decoration:none;background:#0e0d0c}
.btn:hover{background:#fff;color:var(--ink)}
.btn.primary{background:var(--accent);color:var(--ink);border-color:var(--accent)}
`;

  const meta = [
    `<span>Identity<b>${esc(doc.industry || 'Brand')}</b></span>`,
    fh, fi,
    `<span>Document<b>Brand Book v1.0</b></span>`,
  ].filter(Boolean).join('');

  // signature swatches (ground first, then palette)
  const groundSwatches = [
    { hex: ink, n: 'Ink', v: `${ink.toUpperCase()} · the ground` },
    { hex: cream, n: 'Cream', v: `${cream.toUpperCase()} · light field` },
    { hex: '#FFFFFF', n: 'Pure White', v: '#FFFFFF · the reversed mark' },
  ].map((s) => `<div class="swatch"><div class="chip" style="background:${s.hex}"></div><div class="info"><div class="n">${esc(s.n)}</div><div class="v">${esc(s.v)}</div></div></div>`).join('');
  const sigSwatches = pal.length
    ? pal.map((s) => `<div class="swatch"><div class="chip" style="background:${s.hex}"></div><div class="info"><div class="n">${esc(s.label || s.hex.toUpperCase())}</div><div class="v">${esc(s.hex.toUpperCase())}</div></div></div>`).join('')
    : '';

  // applications (generic-adaptive)
  const apps = `
  <div class="app"><div class="canvas"><div class="card"><span class="mark" style="--m:url('${esc(doc.logoUrl)}')"></span><div><div class="ln">${esc(doc.name.toUpperCase())}</div><div class="ln" style="margin-top:4px">${esc(doc.industry || '')}</div></div></div></div><div class="cap">Business card</div></div>
  <div class="app"><div class="canvas" style="background:var(--ink)">${maskMark(symbol, '#fff', 'avatar')}</div><div class="cap">Social avatar</div></div>
  <div class="app"><div class="canvas" style="background:#0d0d0d">${maskMark(doc.logoUrl, '#fff')}</div><div class="cap">Signage</div></div>
  <div class="app"><div class="canvas"><div class="tee"><span class="mark" style="--m:url('${esc(doc.logoUrl)}')"></span></div></div><div class="cap">Merch · positive print</div></div>
  <div class="app"><div class="canvas"><div class="pack"><div class="stripe"></div><span class="mark" style="--m:url('${esc(doc.logoUrl)}')"></span></div></div><div class="cap">Packaging</div></div>
  <div class="app"><div class="canvas" style="background:var(--ink)">${maskMark(symbol, 'rgba(255,255,255,.16)', 'wm')}</div><div class="cap">Watermark</div></div>`;

  // avatar / watermark sizing tweaks
  const extraCss = `.app .avatar{width:60%;height:60%}.app .wm{width:46%;height:46%}.app .canvas .mark{width:62%;height:62%}`;

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
  <span class="logo" style="--m:url('${esc(doc.logoUrl)}')"></span>
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
    <p style="margin-bottom:44px">${esc(c.logomark?.[0] || 'One family of marks. Always reproduce from the master files. Never recreate, retype, or redraw.')}</p>
    <div class="grid2" style="margin-bottom:22px">
      <div><div class="plate dark">${maskMark(doc.logoUrl, '#fff')}</div><div class="label-row"><span class="caps">Primary · reversed</span><span class="caps">on ink</span></div></div>
      <div><div class="plate light">${maskMark(doc.logoUrl, ink)}</div><div class="label-row"><span class="caps">Primary · positive</span><span class="caps">on cream</span></div></div>
    </div>
    <div class="grid3">
      <div><div class="plate dark sq">${maskMark(doc.logoUrl, accent)}</div><div class="label-row"><span class="caps">Accent mark</span><span class="caps">premium</span></div></div>
      <div><div class="plate dark sq">${badge ? `<img class="mark" src="${esc(badge)}" style="width:54%;height:auto">` : `<div class="ring" style="border:2px solid #fff">${maskMark(symbol, '#fff')}</div>`}</div><div class="label-row"><span class="caps">Badge</span><span class="caps">avatars</span></div></div>
      <div><div class="plate dark sq">${maskMark(symbol, '#fff')}</div><div class="label-row"><span class="caps">Symbol</span><span class="caps">app · favicon</span></div></div>
    </div>
  </div>
</section>

<section id="space">
  <div class="wrap">
    <div class="eyebrow">03 — Space & scale</div>
    <h2>Give it air</h2>
    <div class="grid2" style="margin-top:36px;align-items:start">
      <div class="constr"><div class="ruler"></div>${maskMark(doc.logoUrl, '#fff')}</div>
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
    <div class="grid3" style="margin-top:36px">
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
    <p style="margin-bottom:40px">${esc(c.color_intro || 'A near-black ink and a warm cream form the ground; the mark stays monochrome on top. The signature colours carry emphasis and energy, used with discipline.')}</p>
    <div class="caps" style="margin-bottom:16px">Ground</div>
    <div class="grid3" style="margin-bottom:${sigSwatches ? '52px' : '0'}">${groundSwatches}</div>
    ${sigSwatches ? `<div class="caps" style="margin-bottom:16px">Signature</div><div class="grid3">${sigSwatches}</div>` : ''}
  </div>
</section>

<section id="type">
  <div class="wrap">
    <div class="eyebrow">06 — Typography</div>
    <h2>Engineered & quiet</h2>
    <p style="margin-bottom:40px">${esc(c.typeface_intro || 'A tight system: a display face for headlines, a neutral sans for reading, and a monospace for the functional voice of the brand.')}</p>
    <div class="typeblock">
      <div class="name"><div style="font-family:var(--disp);font-size:50px;font-weight:500">${esc(doc.fonts.display.family || 'Display')}</div><span class="caps">Display</span></div>
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
    <div class="grid3" style="margin-top:36px">${apps}</div>
  </div>
</section>

${downloads}

<footer>
  ${maskMark(symbol, '#fff')}
  <div class="caps">${esc(doc.name)} · Brand Book v1.0${doc.tagline ? ' · ' + esc(doc.tagline) : ''}</div>
  <div class="caps" style="margin-top:10px;color:#555">Identity by GRAPPES</div>
</footer>`;

  return `<!DOCTYPE html><html lang="en"><head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${esc(doc.name)} — Brand Book</title>
<link rel="preconnect" href="https://fonts.googleapis.com"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${googleLink}
<style>${css}\n${extraCss}\nfooter .mark{height:54px}</style>
</head><body>${body}</body></html>`;
}
