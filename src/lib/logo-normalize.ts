// Logo SVG normalization for generated sites.
//
// Two problems this solves, both seen with user-uploaded SVGs:
//  1. A baked full-canvas solid-color background (e.g. a white rect covering the
//     whole viewBox) — raster->SVG converters add these. On a contrasting site
//     theme it renders as an ugly box behind the mark.
//  2. A monochrome mark whose color matches the chosen site background (e.g. a
//     near-black mark on a near-black header) — invisible without help.
//
// `stripBakedBackground` fixes (1) deterministically. `logoTone` reports whether
// the mark is dark/light/mixed so the inject step (or a baked light variant) can
// guarantee contrast against the actual theme. `invertMonochrome` bakes a
// luminance-flipped variant for a known theme.

export type LogoTone = 'dark' | 'light' | 'mixed';

/** Parse "#rgb" / "#rrggbb" / "rgb(r,g,b)" / "white"/"black" to [r,g,b], or null. */
export function parseColor(raw: string): [number, number, number] | null {
  const t = raw.trim().toLowerCase();
  if (t === 'none' || t === 'transparent' || t === 'currentcolor' || t.startsWith('url(')) return null;
  if (t === 'white') return [255, 255, 255];
  if (t === 'black') return [0, 0, 0];
  let m = /^#([0-9a-f]{6})$/.exec(t);
  if (m) { const v = parseInt(m[1], 16); return [(v >> 16) & 255, (v >> 8) & 255, v & 255]; }
  m = /^#([0-9a-f]{3})$/.exec(t);
  if (m) { const v = parseInt(m[1], 16); return [((v >> 8) & 15) * 17, ((v >> 4) & 15) * 17, (v & 15) * 17]; }
  m = /^rgba?\(\s*(\d+)[,\s]+(\d+)[,\s]+(\d+)/.exec(t);
  if (m) return [+m[1], +m[2], +m[3]];
  return null;
}

/** Perceptual luminance 0..1. */
export function luminance([r, g, b]: [number, number, number]): number {
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
}

/** A color counts as grayscale when its channels are close together. */
function isGray([r, g, b]: [number, number, number]): boolean {
  return Math.max(r, g, b) - Math.min(r, g, b) <= 28;
}

function viewBox(svg: string): { w: number; h: number } | null {
  const m = /viewBox\s*=\s*["']\s*[\d.+-]+\s+[\d.+-]+\s+([\d.+-]+)\s+([\d.+-]+)\s*["']/i.exec(svg);
  if (m) return { w: parseFloat(m[1]), h: parseFloat(m[2]) };
  const wm = /\bwidth\s*=\s*["']([\d.]+)/i.exec(svg);
  const hm = /\bheight\s*=\s*["']([\d.]+)/i.exec(svg);
  if (wm && hm) return { w: parseFloat(wm[1]), h: parseFloat(hm[1]) };
  return null;
}

/**
 * Remove elements that paint a solid fill covering ~the whole viewBox:
 *  - a <rect> at the origin spanning the full width/height (or 100%/100%),
 *  - a <path> whose `d` just traces the four viewBox corners (a rectangle).
 * Conservative: only removes elements that are unambiguously a full-bleed plate.
 */
export function stripBakedBackground(svg: string): { svg: string; changed: boolean } {
  const vb = viewBox(svg);
  let out = svg;
  let changed = false;

  // Full-canvas <rect>
  out = out.replace(/<rect\b[^>]*>(?:\s*<\/rect>)?/gi, (el) => {
    const num = (re: RegExp) => { const m = re.exec(el); return m ? m[1] : null; };
    const x = num(/\bx\s*=\s*["']([\d.]+)/i) ?? '0';
    const y = num(/\by\s*=\s*["']([\d.]+)/i) ?? '0';
    const w = num(/\bwidth\s*=\s*["']([\d.%]+)/i);
    const h = num(/\bheight\s*=\s*["']([\d.%]+)/i);
    if (parseFloat(x) > 1 || parseFloat(y) > 1 || !w || !h) return el;
    const fullW = w === '100%' || (vb && Math.abs(parseFloat(w) - vb.w) <= 2);
    const fullH = h === '100%' || (vb && Math.abs(parseFloat(h) - vb.h) <= 2);
    if (fullW && fullH) { changed = true; return ''; }
    return el;
  });

  // Full-canvas rectangular <path> (corners of the viewBox)
  if (vb) {
    const W = vb.w, H = vb.h;
    out = out.replace(/<path\b[^>]*\bd\s*=\s*["']([^"']+)["'][^>]*>(?:\s*<\/path>)?/gi, (el, d: string) => {
      const nums = (d.match(/[\d.]+/g) ?? []).map(Number);
      // A pure rectangle path touches only {0, W} in x and {0, H} in y.
      if (nums.length === 0 || nums.length > 12) return el;
      const onlyCorners = nums.every((n, i) =>
        (i % 2 === 0 ? (Math.abs(n) <= 2 || Math.abs(n - W) <= 2) : (Math.abs(n) <= 2 || Math.abs(n - H) <= 2)),
      );
      const spansBoth = nums.some((n) => Math.abs(n - W) <= 2) && nums.some((n) => Math.abs(n - H) <= 2);
      if (onlyCorners && spansBoth) { changed = true; return ''; }
      return el;
    });
  }

  return { svg: out, changed };
}

/** All fill colors present (attribute + style), parsed. */
function fills(svg: string): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const m of svg.matchAll(/fill\s*[:=]\s*["']?([^"';)>]+\)?)/gi)) {
    const c = parseColor(m[1]);
    if (c) out.push(c);
  }
  return out;
}

/** Tone of the mark: most-common grayscale fill decides; any saturated fill => mixed. */
export function logoTone(svg: string): LogoTone {
  const cs = fills(svg);
  if (cs.length === 0) return 'mixed';
  if (cs.some((c) => !isGray(c))) return 'mixed';
  // Pick the most frequent fill (the mark dominates a typical monochrome logo).
  const counts = new Map<string, { c: [number, number, number]; n: number }>();
  for (const c of cs) {
    const k = c.join(',');
    const e = counts.get(k) ?? { c, n: 0 };
    e.n++; counts.set(k, e);
  }
  let best = [...counts.values()][0];
  for (const e of counts.values()) if (e.n > best.n) best = e;
  return luminance(best.c) < 0.5 ? 'dark' : 'light';
}

/** Bake a luminance-flipped variant of a grayscale logo (for a known theme). */
export function invertMonochrome(svg: string): string {
  const flip = (raw: string): string => {
    const c = parseColor(raw);
    if (!c || !isGray(c)) return raw;
    const v = Math.round(255 - (c[0] + c[1] + c[2]) / 3);
    const hex = v.toString(16).padStart(2, '0');
    return `#${hex}${hex}${hex}`;
  };
  let out = svg.replace(/fill\s*=\s*"([^"]+)"/gi, (_m, v) => `fill="${flip(v)}"`);
  out = out.replace(/fill\s*:\s*([^;"}]+)/gi, (_m, v) => `fill:${flip(v)}`);
  return out;
}

export function normalizeLogoSvg(svg: string): { svg: string; changed: boolean; tone: LogoTone } {
  const stripped = stripBakedBackground(svg);
  return { svg: stripped.svg, changed: stripped.changed, tone: logoTone(stripped.svg) };
}

/** Resolve a `--name` custom property to a literal value (follows one var chain). */
function resolveCssVar(html: string, name: string, depth = 0): string | null {
  if (depth > 4) return null;
  const m = new RegExp(`--${name.replace(/[^a-z0-9_-]/gi, '')}\\s*:\\s*([^;}]+)`, 'i').exec(html);
  if (!m) return null;
  const v = m[1].trim();
  const varM = /^var\(\s*--([a-z0-9_-]+)/i.exec(v);
  return varM ? resolveCssVar(html, varM[1], depth + 1) : v;
}

/** Parse a CSS value token to a color, resolving `var(--x)` against the document. */
function colorToken(html: string, token: string): [number, number, number] | null {
  const t = token.trim();
  const varM = /^var\(\s*--([a-z0-9_-]+)/i.exec(t);
  if (varM) {
    const resolved = resolveCssVar(html, varM[1]);
    return resolved ? parseColor(resolved.split(/\s+/)[0]) : null;
  }
  return parseColor(t.split(/\s+/)[0]); // first token, skips gradient/image stacks
}

/** Best-effort luminance (0..1) of the site's dominant background, or null. */
function detectThemeBg(html: string): number | null {
  const rules = [
    /(?:[\s}>;{]|^)body\s*\{[^}]*?background(?:-color)?\s*:\s*([^;}]+)/i,
    /(?:[\s}>;{]|^)html\s*\{[^}]*?background(?:-color)?\s*:\s*([^;}]+)/i,
    /:root\s*\{[^}]*?--(?:bg|background|color-bg|background-color|ink|base|dark|surface)[a-z0-9_-]*\s*:\s*([^;}]+)/i,
  ];
  for (const re of rules) {
    const m = re.exec(html);
    if (m) { const c = colorToken(html, m[1]); if (c) return luminance(c); }
  }
  return null;
}

/**
 * If a monochrome logo would clash with the site theme (dark mark on a dark
 * background, or light mark on a light one), inject a CSS filter that flips the
 * mark so it stays visible. No-op for mixed/colored logos or when the theme
 * can't be determined. This is the runtime-safe complement to stripping the
 * baked background at ingestion: an `<img>`-embedded SVG can't inherit page
 * color, so a CSS filter is the reliable way to adapt it to the theme.
 */
export function injectLogoContrastCss(html: string, tone: LogoTone | undefined): string {
  if (tone !== 'dark' && tone !== 'light') return html;
  const bg = detectThemeBg(html);
  if (bg == null) return html;
  const themeDark = bg < 0.5;
  const clash = (tone === 'dark' && themeDark) || (tone === 'light' && !themeDark);
  if (!clash) return html;
  const css =
    `\n<style>/* auto: flip monochrome logo to contrast the ${themeDark ? 'dark' : 'light'} theme */\n` +
    `.nav-logo img,.footer-logo img,[class*="logo" i] img,header img[alt*="logo" i],img[alt*="logo" i]{filter:invert(1) grayscale(1);}\n</style>`;
  return html.includes('</head>') ? html.replace('</head>', `${css}\n</head>`) : css + html;
}
