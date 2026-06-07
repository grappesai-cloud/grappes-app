// ── Brand Book Lab: HTML renderer ─────────────────────────────────────────────
// Renders the full brand-guidelines document as print-ready HTML. Landscape 4:3
// pages (1200x900), Swiss editorial black/white layout. Same HTML feeds the
// in-app viewer (iframe) and the Puppeteer PDF export.

import type { BrandBookContent } from './brandbook-gen';

export interface BrandBookDoc {
  name: string;
  logoUrl: string;
  typeface: string;                                    // Google Font family
  colors: Array<{ hex: string; label?: string }>;      // brand colors beyond b/w
  donts: string[];
  content: BrandBookContent;
}

// ── helpers ──────────────────────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return {
    r: parseInt(v.slice(0, 2), 16) || 0,
    g: parseInt(v.slice(2, 4), 16) || 0,
    b: parseInt(v.slice(4, 6), 16) || 0,
  };
}

function rgbToCmyk(r: number, g: number, b: number): { c: number; m: number; y: number; k: number } {
  if (r === 0 && g === 0 && b === 0) return { c: 0, m: 0, y: 0, k: 100 };
  const rr = r / 255, gg = g / 255, bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  return {
    c: Math.round(((1 - rr - k) / (1 - k)) * 100),
    m: Math.round(((1 - gg - k) / (1 - k)) * 100),
    y: Math.round(((1 - bb - k) / (1 - k)) * 100),
    k: Math.round(k * 100),
  };
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

// Force the uploaded mark to a flat silhouette so it reads like a real
// monochrome logo on any panel (transparent PNG/SVG assumed).
const LOGO_BLACK: string = 'filter:brightness(0);';
const LOGO_WHITE: string = 'filter:brightness(0) invert(1);';

// ── page chrome ──────────────────────────────────────────────────────────────

interface PageMeta { topic: string; pageNo: number; crumbTop: string; crumbBottom: string; dark?: boolean }

function header(m: PageMeta, brand: string): string {
  const c = m.dark ? '#fff' : '#0a0a0a';
  const rule = m.dark ? 'rgba(255,255,255,0.5)' : 'rgba(10,10,10,0.6)';
  return `
    <div style="display:grid;grid-template-columns:180px 180px 1fr;gap:0;align-items:start;color:${c};">
      <div style="font-size:12px;line-height:1.5;"><b>Topic &mdash; ${esc(m.topic)}</b><br/>Page no. &mdash; ${m.pageNo}</div>
      <div style="font-size:12px;line-height:1.5;"><b>${esc(m.crumbTop)}</b><br/>${esc(m.crumbBottom)}</div>
      <div style="font-size:12px;line-height:1.5;text-align:right;">${esc(brand)} brand guidelines<br/>Version 1.0</div>
    </div>
    <div style="height:1px;background:${rule};margin-top:46px;"></div>
  `;
}

function bigTitle(t: string, dark = false): string {
  return `<h1 style="font-size:64px;font-weight:500;letter-spacing:-0.01em;color:${dark ? '#fff' : '#0a0a0a'};margin:54px 0 0;text-transform:uppercase;">${esc(t)}</h1>`;
}

// 4-row definition table (values / tone / weights / scaling)
function defRows(rows: Array<{ left: string; right: string }>, opts: { leftSize?: number; rightHtml?: boolean } = {}): string {
  return rows.map((r) => `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:40px;padding:30px 0 28px;border-bottom:1px solid rgba(10,10,10,0.35);">
      <div style="font-size:${opts.leftSize ?? 26}px;font-weight:400;letter-spacing:-0.01em;line-height:1.2;">${esc(r.left)}</div>
      <div style="font-size:15.5px;line-height:1.5;max-width:560px;">${opts.rightHtml ? r.right : esc(r.right)}</div>
    </div>
  `).join('');
}

function divider(no: string, title: string, items: Array<[string, string]>): string {
  return `
    <div style="position:absolute;left:436px;top:440px;">
      <h1 style="font-size:76px;font-weight:500;color:#fff;margin:0 0 28px;text-transform:uppercase;letter-spacing:-0.01em;">${esc(title)}</h1>
      ${items.map(([n, t]) => `<div style="display:grid;grid-template-columns:46px 1fr;font-size:17px;color:#fff;line-height:1.65;"><span>${n}</span><span>${esc(t)}</span></div>`).join('')}
    </div>
  `;
}

// ── document ─────────────────────────────────────────────────────────────────

export function renderBrandBookHTML(doc: BrandBookDoc): string {
  const { name, logoUrl, typeface, colors, donts, content: c } = doc;
  const fontParam = typeface.trim().replace(/ /g, '+');
  const pages: string[] = [];
  let pageNo = 0;

  const page = (body: string, opts: { dark?: boolean; meta?: Omit<PageMeta, 'pageNo' | 'dark'> } = {}) => {
    pageNo += 1;
    const bg = opts.dark ? '#0a0a0a' : '#fafafa';
    const head = opts.meta ? header({ ...opts.meta, pageNo, dark: opts.dark }, name) : '';
    pages.push(`<section class="page" style="background:${bg};">${head}${body}</section>`);
  };

  const lockup = (style: typeof LOGO_BLACK, h: number, textColor: string) => `
    <div style="display:inline-flex;align-items:center;gap:${Math.round(h * 0.45)}px;">
      <img src="${esc(logoUrl)}" alt="" style="height:${h}px;width:auto;max-width:${h * 2.4}px;object-fit:contain;${style}" />
      <span style="font-size:${Math.round(h * 0.82)}px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;color:${textColor};line-height:1;">${esc(name)}</span>
    </div>
  `;

  // 1 · Cover
  page(`
    <div style="position:absolute;top:75px;left:436px;font-size:12px;line-height:1.5;color:#fff;">${esc(name)} brand guidelines<br/>Version 1.0</div>
    <div style="height:1px;background:rgba(255,255,255,0.5);position:absolute;top:170px;left:75px;right:75px;"></div>
    <div style="position:absolute;left:436px;top:355px;">
      <img src="${esc(logoUrl)}" alt="" style="height:96px;width:auto;max-width:260px;object-fit:contain;${LOGO_WHITE}" />
      <div style="font-size:58px;font-weight:600;letter-spacing:0.01em;color:#fff;margin-top:34px;text-transform:uppercase;line-height:1.12;">${esc(name)}</div>
      <div style="font-size:58px;font-weight:600;letter-spacing:0.01em;color:rgba(255,255,255,0.42);text-transform:uppercase;line-height:1.12;">Brand guidelines</div>
    </div>
  `, { dark: true });

  // 2 · Introduction
  page(`
    ${bigTitle('Introduction')}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:60px;margin-top:90px;">
      <p style="font-size:15.5px;line-height:1.55;margin:0;">${esc(c.intro[0])}</p>
      <p style="font-size:15.5px;line-height:1.55;margin:0;">${esc(c.intro[1])}</p>
    </div>
  `, { meta: { topic: '1.0', crumbTop: 'Introduction', crumbBottom: '' } });

  // 3 · Table of content
  const tocCol = (rows: Array<[string, string, boolean?]>) => rows.map(([n, t, b]) => `
    <div style="display:grid;grid-template-columns:52px 1fr;font-size:16px;line-height:1.2;padding:5px 0;${b ? 'font-weight:700;padding-top:22px;' : ''}">
      <span>${n}</span><span>${esc(t)}</span>
    </div>
  `).join('');
  page(`
    ${bigTitle('Table of content')}
    <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:60px;margin-top:80px;">
      <div>
        ${tocCol([['1.0', 'Introduction', true], ['1.1', 'Table of content'], ['1.2', 'About the brand'], ['1.3', 'Our Aim & Vision'], ['1.4', 'Brand Values'], ['1.5', 'Tone of voice'],
                  ['2.0', 'Logo', true], ['2.1', 'Logomark'], ['2.2', 'Logotype'], ['2.3', 'Lockup'], ['2.4', 'Clear space'], ['2.5', 'Minimum sizes']])}
      </div>
      <div>
        ${tocCol([['3.0', 'Color', true], ['3.1', 'Color palette'], ['3.2', 'Combinations'],
                  ['4.0', 'Typography', true], ['4.1', 'Typeface'], ['4.2', 'Weights'], ['4.3', 'Type scaling'], ['4.4', 'Common mistakes'],
                  ['5.0', 'Logo misuse', true]])}
      </div>
    </div>
  `, { meta: { topic: '1.1', crumbTop: 'Table of content', crumbBottom: 'Introduction' } });

  // 4 · About the brand
  page(`
    <h1 style="font-size:52px;font-weight:400;letter-spacing:-0.005em;line-height:1.28;margin:54px 0 0;max-width:920px;">${esc(c.about_statement)}</h1>
  `, { meta: { topic: '1.2', crumbTop: 'About the brand', crumbBottom: 'Introduction' } });

  // 5 · Aim & vision
  page(`
    <h1 style="font-size:46px;font-weight:400;line-height:1.3;margin:54px 0 0;max-width:920px;">${esc(c.aim_statement)}</h1>
    <div style="height:1px;background:rgba(10,10,10,0.35);margin:56px 0;"></div>
    <h1 style="font-size:46px;font-weight:400;line-height:1.3;margin:0;max-width:880px;">${esc(c.vision_statement)}</h1>
  `, { meta: { topic: '1.3', crumbTop: 'Our aim & vision', crumbBottom: 'Introduction' } });

  // 6 · Brand values
  page(`
    ${bigTitle('Brand values')}
    <div style="height:1px;background:rgba(10,10,10,0.35);margin:46px 0 0;"></div>
    ${defRows(c.values.map((v) => ({ left: v.title, right: v.description })))}
  `, { meta: { topic: '1.4', crumbTop: 'Brand Values', crumbBottom: 'Introduction' } });

  // 7 · Tone of voice
  page(`
    ${bigTitle('Tone of voice')}
    <div style="height:1px;background:rgba(10,10,10,0.35);margin:46px 0 0;"></div>
    ${defRows(c.tone.map((t) => ({ left: t.title, right: t.description })))}
  `, { meta: { topic: '1.5', crumbTop: 'Tone of voice', crumbBottom: 'Introduction' } });

  // 8 · Divider: logo design
  page(`
    ${header({ topic: '2.0', pageNo: pageNo + 1, crumbTop: 'Introduction', crumbBottom: 'Logo design', dark: true }, name)}
    ${divider('2', 'Logo design', [['2.1', 'Logomark'], ['2.2', 'Logotype'], ['2.3', 'Lockup'], ['2.4', 'Clear space'], ['2.5', 'Minimum sizes']])}
  `, { dark: true });

  // 9 · Logomark
  page(`
    <div style="display:grid;grid-template-columns:300px 1fr 1fr;gap:60px;margin-top:46px;">
      <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0;text-transform:uppercase;">Logomark</h1>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;">${esc(c.logomark[0])}</p>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;">${esc(c.logomark[1])}</p>
    </div>
    <div style="position:absolute;left:75px;right:75px;bottom:75px;top:385px;background:#0a0a0a;display:flex;align-items:center;justify-content:center;">
      <img src="${esc(logoUrl)}" alt="" style="height:120px;width:auto;max-width:320px;object-fit:contain;${LOGO_WHITE}" />
    </div>
  `, { meta: { topic: '2.1', crumbTop: 'Logo design', crumbBottom: 'Logomark' } });

  // 10 · Logotype
  page(`
    <div style="display:grid;grid-template-columns:300px 1fr 1fr;gap:60px;margin-top:46px;">
      <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0;text-transform:uppercase;">Logotype</h1>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;">${esc(c.logotype[0])}</p>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;">${esc(c.logotype[1])}</p>
    </div>
    <div style="position:absolute;left:75px;right:75px;bottom:75px;top:385px;border:1px solid #0a0a0a;display:flex;align-items:center;justify-content:center;">
      <span style="font-size:64px;font-weight:600;letter-spacing:0.02em;text-transform:uppercase;">${esc(name)}</span>
    </div>
  `, { meta: { topic: '2.2', crumbTop: 'Logotype', crumbBottom: 'Logomark' } });

  // 11 · Lockup
  page(`
    <div style="display:grid;grid-template-columns:440px 1fr;gap:70px;margin-top:46px;height:640px;">
      <div>
        <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0 0 90px;text-transform:uppercase;">Logo lockup</h1>
        <p style="font-size:15.5px;line-height:1.55;margin:0;max-width:330px;">${esc(c.lockup)}</p>
      </div>
      <div style="background:#0a0a0a;display:flex;align-items:center;justify-content:center;">
        ${lockup(LOGO_WHITE, 52, '#fff')}
      </div>
    </div>
  `, { meta: { topic: '2.3', crumbTop: 'Logo lockup', crumbBottom: 'Logomark' } });

  // 12 · Clear space
  page(`
    <div style="display:grid;grid-template-columns:340px 1fr;gap:60px;margin-top:40px;">
      <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0;text-transform:uppercase;">Clear space</h1>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;max-width:520px;">${esc(c.clear_space)}</p>
    </div>
    <div style="position:absolute;left:64px;right:64px;bottom:55px;top:400px;background:#0a0a0a;display:flex;align-items:center;justify-content:center;">
      <div style="position:relative;padding:46px 56px;border:1px solid rgba(255,255,255,0.55);">
        <div style="position:absolute;inset:46px 56px;border:1px solid rgba(255,255,255,0.35);"></div>
        ${lockup(LOGO_WHITE, 40, '#fff')}
      </div>
    </div>
  `, { meta: { topic: '2.4', crumbTop: 'Clear space', crumbBottom: 'Logomark' } });

  // 13 · Minimum sizes
  page(`
    <div style="display:grid;grid-template-columns:340px 1fr;gap:60px;margin-top:40px;">
      <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0;line-height:1.1;text-transform:uppercase;">Minimum<br/>sizes</h1>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;max-width:520px;">${esc(c.minimum_sizes)}</p>
    </div>
    <div style="position:absolute;left:64px;right:64px;bottom:55px;top:400px;border:1px solid #0a0a0a;display:flex;align-items:center;justify-content:center;gap:26px;">
      ${lockup(LOGO_BLACK, 34, '#0a0a0a')}
      <div style="display:flex;align-items:center;gap:12px;">
        <div style="width:1px;height:44px;background:#0a0a0a;position:relative;">
          <div style="position:absolute;top:0;left:-5px;width:11px;height:1px;background:#0a0a0a;"></div>
          <div style="position:absolute;bottom:0;left:-5px;width:11px;height:1px;background:#0a0a0a;"></div>
        </div>
        <span style="font-size:15px;">.75&rdquo; or 50px</span>
      </div>
    </div>
  `, { meta: { topic: '2.5', crumbTop: 'Minimum Sizes', crumbBottom: 'Logomark' } });

  // 14 · Divider: colors
  page(`
    ${header({ topic: '3.0', pageNo: pageNo + 1, crumbTop: 'Introduction', crumbBottom: 'Colors', dark: true }, name)}
    ${divider('3', 'Colors', [['3.1', 'Color palette'], ['3.2', 'Combinations']])}
  `, { dark: true });

  // 15+ · Color palette — White & Black panel, then brand colors 2-up per page
  const tintRows = (hex: string, dark: boolean) => {
    const steps = [20, 40, 60, 80];
    return steps.map((p) => {
      const overlay = dark
        ? `background:rgba(255,255,255,${p / 100});`
        : `background:rgba(10,10,10,${p / 100});`;
      const txt = dark ? (p >= 60 ? '#0a0a0a' : '#fff') : (p >= 40 ? '#fff' : '#0a0a0a');
      return `<div style="height:52px;${overlay}display:flex;align-items:center;justify-content:flex-end;padding:0 22px;font-size:14px;color:${txt};">${p}%</div>`;
    }).join('');
  };
  const valueBlock = (hex: string, color: string) => {
    const { r, g, b } = hexToRgb(hex);
    const { c: cc, m, y, k } = rgbToCmyk(r, g, b);
    const row = (a: string, va: number, bl: string, vb: number | string) =>
      `<div style="display:grid;grid-template-columns:54px 60px 54px 1fr;font-size:14.5px;line-height:1.75;color:${color};"><span>${a}:</span><span>${va}</span><span>${bl}:</span><span>${vb}</span></div>`;
    return row('C', cc, 'R', r) + row('M', m, 'G', g) + row('Y', y, 'B', b) + `<div style="display:grid;grid-template-columns:54px 1fr;font-size:14.5px;line-height:1.75;color:${color};"><span>K:</span><span>${k}</span></div>`;
  };
  const colorPanel = (hex: string, label: string) => {
    const dark = luminance(hex) < 0.45;
    const fg = dark ? '#fff' : '#0a0a0a';
    const border = luminance(hex) > 0.85 ? 'border:1px solid rgba(10,10,10,0.6);' : '';
    return `
      <div style="background:${hex};${border}display:flex;flex-direction:column;">
        <div style="padding:42px 46px;flex:1;">
          <div style="font-size:44px;font-weight:400;color:${fg};margin-bottom:30px;">${esc(label)}</div>
          ${valueBlock(hex, fg)}
        </div>
        <div>${tintRows(hex, dark)}</div>
      </div>
    `;
  };
  page(`
    <div style="position:absolute;left:75px;right:75px;top:170px;bottom:75px;display:grid;grid-template-columns:1fr 1fr;">
      ${colorPanel('#fafafa', 'White')}
      ${colorPanel('#0a0a0a', 'Black')}
    </div>
  `, { meta: { topic: '3.1', crumbTop: 'Color Palette', crumbBottom: 'Colors' } });

  for (let i = 0; i < colors.length; i += 2) {
    const pair = colors.slice(i, i + 2);
    page(`
      <div style="position:absolute;left:75px;right:75px;top:170px;bottom:75px;display:grid;grid-template-columns:${pair.length === 2 ? '1fr 1fr' : '1fr'};">
        ${pair.map((col, j) => colorPanel(col.hex, col.label || `Brand color ${i + j + 1}`)).join('')}
      </div>
    `, { meta: { topic: '3.1', crumbTop: 'Color Palette', crumbBottom: 'Colors' } });
  }

  // Combinations
  const comboPanel = (hex: string) => {
    const dark = luminance(hex) < 0.45;
    const border = luminance(hex) > 0.85 ? 'border:1px solid rgba(10,10,10,0.6);' : '';
    return `<div style="background:${hex};${border}display:flex;align-items:center;justify-content:center;">${lockup(dark ? LOGO_WHITE : LOGO_BLACK, 30, dark ? '#fff' : '#0a0a0a')}</div>`;
  };
  const comboColors = ['#fafafa', '#0a0a0a', ...colors.map((x) => x.hex)].slice(0, 4);
  page(`
    <div style="display:grid;grid-template-columns:340px 1fr;gap:60px;margin-top:40px;">
      <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0;text-transform:uppercase;">Combinations</h1>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;max-width:480px;">${esc(c.combinations)}</p>
    </div>
    <div style="position:absolute;left:75px;right:75px;top:400px;bottom:75px;display:grid;grid-template-columns:1fr 1fr;${comboColors.length > 2 ? 'grid-template-rows:1fr 1fr;' : ''}gap:0;">
      ${comboColors.map(comboPanel).join('')}
    </div>
  `, { meta: { topic: '3.2', crumbTop: 'Combinations', crumbBottom: 'Colors' } });

  // Divider: typography
  page(`
    ${header({ topic: '4.0', pageNo: pageNo + 1, crumbTop: 'Introduction', crumbBottom: 'Typography', dark: true }, name)}
    ${divider('4', 'Typography', [['4.1', 'Typeface'], ['4.2', 'Weights'], ['4.3', 'Type scaling'], ['4.4', 'Common mistakes']])}
  `, { dark: true });

  // Typeface
  page(`
    <div style="display:grid;grid-template-columns:300px 1fr;gap:60px;margin-top:40px;">
      <h1 style="font-size:48px;font-weight:500;letter-spacing:-0.01em;margin:0;text-transform:uppercase;">Typeface</h1>
      <p style="font-size:15.5px;line-height:1.55;margin:6px 0 0;max-width:560px;">${esc(c.typeface_intro)}</p>
    </div>
    <div style="position:absolute;left:75px;right:75px;top:360px;bottom:75px;background:#0a0a0a;display:flex;align-items:center;padding:0 48px;">
      <div style="font-size:104px;font-weight:500;color:#fff;line-height:1.04;text-transform:uppercase;letter-spacing:-0.01em;">${esc(typeface)}</div>
    </div>
  `, { meta: { topic: '4.1', crumbTop: 'Typeface', crumbBottom: 'Typography' } });

  // Weights
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ<br/>abcdefghijklmnopqrstuvwxyz<br/>0123456789&deg; (!&quot;#$%&amp;?@)';
  page(`
    ${bigTitle('Weights')}
    <div style="height:1px;background:rgba(10,10,10,0.35);margin:42px 0 0;"></div>
    ${[['Regular', 400], ['Medium', 500], ['Semi-Bold', 600], ['Bold', 700]].map(([label, w]) => `
      <div style="display:grid;grid-template-columns:300px 1fr;gap:40px;padding:22px 0 20px;border-bottom:1px solid rgba(10,10,10,0.35);">
        <div style="font-size:24px;font-weight:400;">${label}</div>
        <div style="font-size:21px;font-weight:${w};line-height:1.4;">${alphabet}</div>
      </div>
    `).join('')}
  `, { meta: { topic: '4.2', crumbTop: 'Weights', crumbBottom: 'Typography' } });

  // Type scaling
  page(`
    ${bigTitle('Type scaling')}
    <div style="height:1px;background:rgba(10,10,10,0.35);margin:42px 0 0;"></div>
    ${[[64, 'Heading 1'], [48, 'Heading 2'], [36, 'Heading 3'], [24, 'Heading 4']].map(([px, label]) => `
      <div style="display:grid;grid-template-columns:180px 1fr;gap:40px;padding:18px 0 16px;border-bottom:1px solid rgba(10,10,10,0.35);align-items:center;">
        <div style="font-size:14.5px;">${px} Px</div>
        <div style="font-size:${px}px;font-weight:400;letter-spacing:-0.01em;line-height:1.1;">${label}</div>
      </div>
    `).join('')}
  `, { meta: { topic: '4.3', crumbTop: 'Type scaling', crumbBottom: 'Typography' } });

  // Common mistakes (logo + type misuse, 6 boxes, red strike)
  const strike = `<div style="position:absolute;inset:0;background:linear-gradient(to top right, transparent 48.8%, #e02020 48.8%, #e02020 51.2%, transparent 51.2%);"></div>`;
  const mistakes = donts.slice(0, 6);
  page(`
    ${bigTitle('Common mistakes')}
    <div style="display:grid;grid-template-columns:repeat(3,1fr);grid-template-rows:1fr 1fr;gap:34px;position:absolute;left:75px;right:75px;top:330px;bottom:75px;">
      ${mistakes.map((m) => `
        <div style="position:relative;border:1px solid rgba(10,10,10,0.55);display:flex;align-items:center;justify-content:center;padding:20px;">
          ${strike}
          <span style="font-size:19px;font-weight:500;text-align:center;line-height:1.35;">${esc(m)}</span>
        </div>
      `).join('')}
    </div>
  `, { meta: { topic: '4.4', crumbTop: 'Common mistakes', crumbBottom: 'Typography' } });

  // Closing
  page(`
    <div style="position:absolute;top:75px;left:75px;right:75px;display:flex;justify-content:space-between;color:#fff;font-size:12px;line-height:1.5;">
      <div><b>Topic &mdash; 5.0</b><br/>Page no. &mdash; ${pageNo + 1}</div>
      <div style="text-align:right;">${esc(name)} brand guidelines<br/>Version 1.0</div>
    </div>
    <div style="position:absolute;left:0;right:0;top:0;bottom:0;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:30px;">
      ${lockup(LOGO_WHITE, 44, '#fff')}
      <div style="font-size:21px;color:rgba(255,255,255,0.65);max-width:560px;text-align:center;line-height:1.5;">${esc(c.closing)}</div>
      <div style="font-size:13px;letter-spacing:0.22em;text-transform:uppercase;color:rgba(255,255,255,0.4);">${esc(c.tagline)}</div>
    </div>
  `, { dark: true });

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(name)} — Brand guidelines</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@400;500;600;700&display=swap" rel="stylesheet" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { background:#1a1a1a; }
  body { font-family:'${typeface.replace(/'/g, '')}', 'Helvetica Neue', Arial, sans-serif; color:#0a0a0a; }
  .page {
    position:relative; width:1200px; height:900px; overflow:hidden;
    padding:75px; page-break-after:always; margin:0 auto;
  }
  @page { size:1200px 900px; margin:0; }
  @media screen { .page { margin-bottom:16px; } }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}
