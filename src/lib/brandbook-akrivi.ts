// ── Brand Book Lab: Akrivi-style renderers ────────────────────────────────────
// Three 16:9 (1280x720) template families ported from the Akrivi Brand
// Guidelines set: 'corporate' (Swiss blue, Inter), 'urban' (Anton caps on an
// accent color), 'contemporary' (full-color pages with outline circles).
// Same BrandBookDoc content model as the 'editorial' renderer.

import type { BrandBookDoc } from './brandbook-template';

export type AkriviStyle = 'corporate' | 'urban' | 'contemporary';

// ── color helpers ─────────────────────────────────────────────────────────────

function esc(s: string): string {
  return (s ?? '').toString().replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string
  ));
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '');
  const v = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
  return { r: parseInt(v.slice(0, 2), 16) || 0, g: parseInt(v.slice(2, 4), 16) || 0, b: parseInt(v.slice(4, 6), 16) || 0 };
}

function rgbToHex(r: number, g: number, b: number): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0');
  return `#${c(r)}${c(g)}${c(b)}`;
}

function shade(hex: string, amt: number): string {
  // amt > 0 lightens toward white, amt < 0 darkens toward black (0..1)
  const { r, g, b } = hexToRgb(hex);
  const t = amt > 0 ? 255 : 0;
  const a = Math.abs(amt);
  return rgbToHex(r + (t - r) * a, g + (t - g) * a, b + (t - b) * a);
}

function luminance(hex: string): number {
  const { r, g, b } = hexToRgb(hex);
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
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

// Logo is shown AS-IS (never recolored). These no-ops keep call sites unchanged.
const LOGO_BLACK = '';
const LOGO_WHITE = '';
const logoFilterFor = (_bgHex: string) => '';
const inkFor = (bgHex: string) => (luminance(bgHex) < 0.45 ? '#ffffff' : '#0d0d0d');

const DEFAULT_PRIMARY: Record<AkriviStyle, string> = {
  corporate: '#1766e8',
  urban: '#f0594e',
  contemporary: '#12b35f',
};

// ── renderer ──────────────────────────────────────────────────────────────────

export function renderAkriviHTML(doc: BrandBookDoc, style: AkriviStyle): string {
  const { name, logoUrl, typeface, colors, donts, content: c } = doc;
  const primary = colors[0]?.hex || DEFAULT_PRIMARY[style];
  const primaryInk = inkFor(primary);
  const urban = style === 'urban';
  const headingFont = urban ? 'Anton' : typeface;
  const headingCase = urban ? 'text-transform:uppercase;letter-spacing:0.01em;' : '';
  const panel = '#eef1f4';
  const logoIsLight = doc.logoIsLight !== false;
  const year = '2025';

  const pages: string[] = [];
  let pageNo = 0;

  const page = (body: string, bg: string) => {
    pageNo += 1;
    pages.push(`<section class="page" style="background:${bg};color:${inkFor(bg)};">${body}</section>`);
  };

  const h = (size: number, color?: string) =>
    `font-family:'${headingFont}',sans-serif;font-weight:${urban ? 400 : 700};${headingCase}font-size:${size}px;line-height:1.05;${color ? `color:${color};` : ''}`;

  const footer = (bg: string) => {
    const ink = inkFor(bg);
    return `<div style="position:absolute;left:64px;right:64px;bottom:40px;display:grid;grid-template-columns:1fr auto 1fr;font-size:12px;color:${ink};opacity:0.9;">
      <span>${esc(name)} Brand Guidelines</span><span>${year}</span>
      <span style="text-align:right;">${String(pageNo + 1).padStart(2, '0')}</span>
    </div>`;
  };

  const headerRow = (title: string, sectionLabel: string) => `
    <div style="display:grid;grid-template-columns:300px 1fr auto;gap:24px;align-items:baseline;">
      <div style="${h(20)}">${esc(title)}</div>
      <div style="font-size:13.5px;font-weight:600;">${esc(sectionLabel)}</div>
      <div style="font-size:12px;">${String(pageNo + 1).padStart(2, '0')}</div>
    </div>`;

  // Definition rows (positioning / values / tone)
  const rows = (items: Array<{ t: string; d: string }>) => items.map((it) => `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;padding:24px 0;border-top:1px solid rgba(13,13,13,0.12);">
      <div style="${h(21)}">${esc(it.t)}</div>
      <div style="font-size:14.5px;line-height:1.55;max-width:560px;">${esc(it.d)}</div>
    </div>`).join('');

  // Standard content page per style
  const contentPage = (title: string, sectionLabel: string, body: string) => {
    if (urban) {
      page(`
        <div style="position:absolute;inset:0;display:grid;grid-template-columns:285px 1fr;">
          <div style="background:${panel};padding:48px 36px;">
            <div style="${h(19)}">${esc(title)}</div>
          </div>
          <div style="padding:48px 64px 64px 56px;position:relative;">${body}</div>
        </div>
        <div style="position:absolute;left:36px;bottom:40px;font-size:12px;">${String(pageNo + 1).padStart(2, '0')}</div>
      `, '#ffffff');
    } else {
      page(`
        ${headerRow(title, sectionLabel)}
        <div style="margin-top:26px;">${body}</div>
        ${footer('#ffffff')}
      `, '#ffffff');
    }
  };

  const lockup = (filter: string, hpx: number, color: string) => `
    <div style="display:inline-flex;align-items:center;gap:${Math.round(hpx * 0.4)}px;">
      <img src="${esc(logoUrl)}" alt="" style="height:${hpx}px;width:auto;max-width:${hpx * 2.4}px;object-fit:contain;${filter}" />
      <span style="${h(Math.round(hpx * 0.78), color)}">${esc(name)}</span>
    </div>`;

  const circles = (stroke: string, corner: 'bl' | 'tr') => {
    const pos = corner === 'bl' ? 'left:-180px;bottom:-220px;' : 'right:-180px;top:-220px;';
    const pos2 = corner === 'bl' ? 'left:40px;bottom:-340px;' : 'right:40px;top:-340px;';
    return `
      <div style="position:absolute;${pos}width:520px;height:520px;border:14px solid ${stroke};border-radius:50%;"></div>
      <div style="position:absolute;${pos2}width:560px;height:560px;border:14px solid ${stroke};border-radius:50%;"></div>`;
  };

  // ── 1 · Cover ──────────────────────────────────────────────────────────────
  if (style === 'corporate') {
    page(`
      <div style="position:absolute;top:56px;left:64px;">${lockup(logoFilterFor(primary), 26, primaryInk)}</div>
      <div style="position:absolute;left:64px;top:230px;${h(96, primaryInk)}">Brand<br/>Guidelines</div>
      <div style="position:absolute;left:64px;bottom:40px;font-size:13px;color:${primaryInk};">${esc(name)}<br/>Brand Guidelines</div>
      <div style="position:absolute;right:64px;bottom:40px;font-size:13px;color:${primaryInk};">${year}</div>
    `, primary);
  } else if (urban) {
    page(`
      <div style="position:absolute;top:48px;left:64px;"><img src="${esc(logoUrl)}" alt="" style="height:54px;width:auto;max-width:140px;object-fit:contain;${logoFilterFor(primary)}" /></div>
      <div style="position:absolute;left:64px;top:200px;${h(120, primaryInk)}">Brand<br/>Guidelines</div>
      <div style="position:absolute;left:64px;bottom:40px;${h(15, primaryInk)}">${esc(name)} Brand Guidelines</div>
      <div style="position:absolute;right:64px;bottom:40px;font-size:13px;color:${primaryInk};">${year}</div>
    `, primary);
  } else {
    page(`
      ${circles(shade(primary, -0.25), 'bl')}
      <div style="position:absolute;left:520px;top:64px;${h(76, primaryInk)}">Brand<br/>Guidelines</div>
      <div style="position:absolute;left:40px;bottom:40px;font-size:13px;font-weight:700;color:${primaryInk};">${esc(name)}<br/>Version 1.0</div>
      <div style="position:absolute;right:40px;bottom:40px;font-size:13px;font-weight:700;color:${primaryInk};">${year}</div>
    `, primary);
  }

  // ── 2 · Introduction ───────────────────────────────────────────────────────
  if (style === 'contemporary') {
    page(`
      <div style="position:absolute;top:44px;left:40px;max-width:400px;">
        <div style="font-size:15px;font-weight:700;color:${primaryInk};margin-bottom:46px;">Introduction</div>
        <p style="font-size:13.5px;line-height:1.55;color:${primaryInk};margin:0;">${esc(c.intro[1])}</p>
      </div>
      <div style="position:absolute;left:40px;right:120px;bottom:56px;${h(44, primaryInk)};line-height:1.25;">${esc(c.intro[0])}</div>
    `, primary);
  } else {
    page(`
      <div style="position:absolute;top:48px;left:64px;${h(20, '#fff')}">Introduction</div>
      <div style="position:absolute;left:380px;top:140px;right:120px;${h(urban ? 44 : 36, '#fff')};line-height:1.3;">${esc(c.intro[0])}</div>
      <div style="position:absolute;left:380px;bottom:140px;max-width:480px;font-size:13.5px;line-height:1.55;color:#fff;">${esc(c.intro[1])}</div>
      <div style="position:absolute;left:64px;bottom:40px;font-size:12px;color:#fff;">${String(pageNo + 1).padStart(2, '0')}</div>
    `, '#0d0d0d');
  }

  // ── 3 · Table of contents ──────────────────────────────────────────────────
  const TOC = [['1.0', 'Brand Overview'], ['2.0', 'Logo'], ['3.0', 'Colors'], ['4.0', 'Typography'], ['5.0', 'Thank You']];
  if (style === 'contemporary') {
    page(`
      <div style="position:absolute;top:44px;left:40px;font-size:15px;font-weight:700;color:${primaryInk};">Table of Contents</div>
      <div style="position:absolute;top:44px;left:520px;">
        ${TOC.map(([n, t]) => `<div style="display:grid;grid-template-columns:56px 1fr;font-size:19px;font-weight:700;color:${primaryInk};padding:6px 0;"><span>${n}</span><span>${esc(t)}</span></div>`).join('')}
      </div>
    `, primary);
  } else {
    const ink = urban ? '#fff' : '#0d0d0d';
    page(`
      <div style="position:absolute;top:48px;left:64px;${h(20, ink)}">Table of Contents</div>
      <div style="position:absolute;top:150px;left:430px;">
        ${TOC.map(([n, t], i) => `<div style="${h(urban ? 34 : 30, ink)};margin-bottom:22px;">0${i + 1}. ${esc(t)}</div>`).join('')}
      </div>
      <div style="position:absolute;left:64px;bottom:40px;font-size:12px;color:${ink};">${String(pageNo + 1).padStart(2, '0')}</div>
    `, urban ? '#0d0d0d' : '#ffffff');
  }

  // ── Divider helper ─────────────────────────────────────────────────────────
  const divider = (no: string, title: string, items: Array<[string, string]>) => {
    if (style === 'corporate') {
      page(`<div style="position:absolute;left:64px;bottom:64px;${h(86, primaryInk)}">${esc(title)}</div>`, shade(primary, -0.35));
    } else if (urban) {
      page(`
        <div style="position:absolute;top:44px;left:64px;font-size:13px;color:${primaryInk};">${esc(name)} Brand Guidelines</div>
        <div style="position:absolute;top:44px;right:64px;font-size:13px;color:${primaryInk};">${year}</div>
        <div style="position:absolute;left:64px;top:300px;${h(86, primaryInk)}">${esc(title)}</div>
        <div style="position:absolute;right:64px;top:300px;${h(86, primaryInk)}">${no}</div>
        <div style="position:absolute;left:64px;bottom:56px;">
          ${items.map(([n, t]) => `<div style="display:grid;grid-template-columns:64px 1fr;${h(17, primaryInk)};padding:3px 0;"><span>${n}</span><span>${esc(t)}</span></div>`).join('')}
        </div>
      `, primary);
    } else {
      page(`
        ${circles(shade(primary, -0.25), no === '2.0' ? 'tr' : 'bl')}
        <div style="position:absolute;top:56px;left:40px;${h(64, primaryInk)};font-weight:400;">${no}</div>
        <div style="position:absolute;top:56px;left:520px;${h(64, primaryInk)}">${esc(title)}</div>
      `, primary);
    }
  };

  // ── Brand overview section ─────────────────────────────────────────────────
  divider('1.0', 'Brand Overview', [['1.1', 'Brand Positioning'], ['1.2', 'Core Values'], ['1.3', 'Tone of Voice']]);

  const mission = c.about_statement.replace(/^about the brand\s*[—:-]?\s*/i, '');
  contentPage('Brand Positioning', 'Brand Overview', rows([
    { t: 'Purpose', d: c.aim_statement },
    { t: 'Vision', d: c.vision_statement },
    { t: 'Mission', d: mission },
  ]));
  contentPage('Core Values', 'Brand Overview', rows(c.values.map((v) => ({ t: v.title, d: v.description }))));
  contentPage('Tone of Voice', 'Brand Overview', rows(c.tone.map((t) => ({ t: t.title, d: t.description }))));

  // ── Logo section ───────────────────────────────────────────────────────────
  divider('2.0', 'Logo', [['2.1', 'Logomark'], ['2.2', 'Logotype'], ['2.3', 'Full Logo'], ['2.4', 'Minimum Size'], ['2.5', 'Logo Backgrounds'], ['2.6', 'Misuses']]);

  // Logo-hosting panel adapts to the mark's own tone (light mark → dark panel).
  const showPanel = logoIsLight ? '#0d0d0d' : '#eef1f4';
  const showInk = inkFor(showPanel);

  const showcase = (inner: string, text: string, title: string) => contentPage(title, 'Logo', `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;">
      <p style="font-size:14px;line-height:1.55;margin:0;">${esc(text)}</p>
      <div style="background:${showPanel};border-radius:14px;height:470px;display:flex;align-items:center;justify-content:center;">${inner}</div>
    </div>`);

  showcase(`<img src="${esc(logoUrl)}" alt="" style="height:130px;width:auto;max-width:380px;object-fit:contain;" />`, c.logomark[0], 'Logomark');
  showcase(`<span style="${h(72, showInk)}">${esc(name)}</span>`, c.logotype[0], 'Logotype');
  showcase(lockup(LOGO_BLACK, 64, showInk), c.lockup, 'Full Logo');

  // Minimum size
  contentPage('Minimum Size', 'Logo', `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;">
      <p style="font-size:14px;line-height:1.55;margin:0;">${esc(c.minimum_sizes)}</p>
      <div style="background:${showPanel};color:${showInk};border-radius:14px;height:470px;padding:56px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="display:flex;gap:120px;">
          <div><img src="${esc(logoUrl)}" alt="" style="height:46px;width:auto;max-width:110px;object-fit:contain;" />
            <div style="${h(15, showInk)};margin-top:14px;">Logomark</div>
            <div style="font-size:11.5px;margin-top:6px;line-height:1.5;">Print: 10mm<br/>Digital: 50px</div></div>
          <div><span style="${h(40, showInk)}">${esc(name)}</span>
            <div style="${h(15, showInk)};margin-top:14px;">Logotype</div>
            <div style="font-size:11.5px;margin-top:6px;line-height:1.5;">Print: 50mm<br/>Digital: 150px</div></div>
        </div>
        <div>${lockup(LOGO_BLACK, 36, showInk)}
          <div style="${h(15, showInk)};margin-top:14px;">Full Logo</div>
          <div style="font-size:11.5px;margin-top:6px;line-height:1.5;">Print: 50mm<br/>Digital: 150px</div></div>
      </div>
    </div>`);

  // Logo backgrounds — only tiles that contrast the mark's tone (no recolor).
  const bgTiles = logoIsLight
    ? [primary, shade(primary, -0.3), shade(primary, -0.55), '#0d0d0d', '#3a3a3a', '#5c5c5c']
    : [primary, shade(primary, 0.35), shade(primary, 0.6), '#fafafa', '#e4e4e4', '#c9cdd1'];
  contentPage('Logo Backgrounds', 'Logo', `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;">
      <p style="font-size:14px;line-height:1.55;margin:0;">${esc(c.combinations)}</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);grid-auto-rows:226px;gap:14px;">
        ${bgTiles.map((bgc) => `
          <div style="background:${bgc};${luminance(bgc) > 0.9 ? 'border:1px solid rgba(13,13,13,0.18);' : ''}border-radius:12px;display:flex;align-items:center;justify-content:center;">
            ${lockup(LOGO_WHITE, 22, inkFor(bgc))}
          </div>`).join('')}
      </div>
    </div>`);

  // Misuse
  contentPage('Logo Misuse', 'Logo', `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;">
      <p style="font-size:14px;line-height:1.55;margin:0;">To protect the brand's integrity, the logo must never be altered. Avoid stretching, rotating, re-coloring, or adding effects.</p>
      <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:16px;">
        ${donts.slice(0, 6).map((m) => `
          <div>
            <div style="position:relative;background:${showPanel};border-radius:10px;height:130px;display:flex;align-items:center;justify-content:center;overflow:hidden;">
              ${lockup(LOGO_BLACK, 18, showInk)}
              <div style="position:absolute;inset:0;background:linear-gradient(to top right, transparent 49%, #e02020 49%, #e02020 51%, transparent 51%);"></div>
            </div>
            <p style="font-size:11.5px;line-height:1.5;margin:8px 0 0;">${esc(m)}</p>
          </div>`).join('')}
      </div>
    </div>`);

  // ── Colors section ─────────────────────────────────────────────────────────
  divider('3.0', 'Colors', [['3.1', 'Color Palette']]);

  const valuesBlock = (hex: string) => {
    const { r, g, b } = hexToRgb(hex);
    const { c: cc, m, y, k } = rgbToCmyk(r, g, b);
    return `Hex: ${hex.toUpperCase()}<br/>RGB: ${r}, ${g}, ${b}<br/>CMYK: ${cc}, ${m}, ${y}, ${k}`;
  };
  const colorCol = (hex: string, label: string) => `
    <div style="background:${hex};${luminance(hex) > 0.9 ? 'border:1px solid rgba(13,13,13,0.15);' : ''}padding:24px;display:flex;flex-direction:column;justify-content:space-between;color:${inkFor(hex)};">
      <div style="font-size:15px;font-weight:700;">${esc(label)}</div>
      <div style="font-size:11.5px;line-height:1.6;">${valuesBlock(hex)}</div>
    </div>`;
  const paletteCols = [
    colorCol(primary, 'Primary Color'),
    ...colors.slice(1, 3).map((col, i) => colorCol(col.hex, col.label || `Brand Color ${i + 2}`)),
    colorCol('#0d0d0d', 'Black'),
    colorCol('#ffffff', 'White'),
  ];
  contentPage('Color Palette', 'Colors', `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;">
      <p style="font-size:14px;line-height:1.55;margin:0;">${esc(c.color_intro)}</p>
      <div style="display:grid;grid-template-columns:repeat(${paletteCols.length},1fr);height:470px;border-radius:14px;overflow:hidden;">${paletteCols.join('')}</div>
    </div>`);

  // ── Typography section ─────────────────────────────────────────────────────
  divider('4.0', 'Typography', [['4.1', 'Typeface']]);

  contentPage('Typeface', 'Typography', `
    <div style="display:grid;grid-template-columns:300px 1fr;gap:30px;">
      <p style="font-size:14px;line-height:1.55;margin:0;">${esc(c.typeface_intro)}</p>
      <div style="background:${panel};border-radius:14px;height:470px;padding:48px;display:flex;flex-direction:column;justify-content:space-between;">
        <div style="font-family:'${typeface}',sans-serif;font-weight:700;font-size:84px;line-height:1;">${esc(typeface)}</div>
        <div style="font-family:'${typeface}',sans-serif;font-size:26px;line-height:1.5;">ABCDEFGHIJKLMNOPQRSTUVWXYZ<br/>abcdefghijklmnopqrstuvwxyz<br/>0123456789 !@#$^&amp;*()_+=;'&lt;&gt;,./?</div>
      </div>
    </div>`);

  // ── Thank you ──────────────────────────────────────────────────────────────
  page(`
    ${style === 'contemporary' ? circles(shade(primary, -0.25), 'tr') : ''}
    <div style="position:absolute;left:64px;top:280px;${h(style === 'urban' ? 100 : 80, primaryInk)}">Thank You</div>
    <div style="position:absolute;left:64px;bottom:96px;max-width:560px;font-size:15px;line-height:1.55;color:${primaryInk};">${esc(c.closing)}</div>
    <div style="position:absolute;left:64px;bottom:48px;font-size:12px;letter-spacing:0.18em;text-transform:uppercase;color:${primaryInk};opacity:0.75;">${esc(c.tagline)}</div>
  `, style === 'corporate' ? shade(primary, -0.35) : primary);

  const fontParam = typeface.trim().replace(/ /g, '+');
  const antonLink = urban ? '&family=Anton' : '';
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<title>${esc(name)} — Brand guidelines</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=${fontParam}:wght@400;500;600;700${antonLink}&display=swap" rel="stylesheet" />
<style>
  * { margin:0; padding:0; box-sizing:border-box; -webkit-print-color-adjust:exact; print-color-adjust:exact; }
  html, body { background:#1a1a1a; }
  body { font-family:'${typeface.replace(/'/g, '')}', 'Helvetica Neue', Arial, sans-serif; color:#0d0d0d; }
  .page {
    position:relative; width:1280px; height:720px; overflow:hidden;
    padding:48px 64px; page-break-after:always; margin:0 auto;
  }
  @page { size:1280px 720px; margin:0; }
  @media screen { .page { margin-bottom:16px; } }
</style>
</head>
<body>
${pages.join('\n')}
</body>
</html>`;
}
