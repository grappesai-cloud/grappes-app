// ─── QA Engine ────────────────────────────────────────────────────────────────
// Runs SEO, accessibility, and HTML structure checks on generated HTML files.
// Pure string-based — no browser required. Fast enough to run inline after generation.

export type CheckStatus = 'pass' | 'warn' | 'fail';

export type QACategory =
  | 'seo' | 'accessibility' | 'structure' | 'performance'
  | 'persona' | 'typography' | 'contrast' | 'animation'
  | 'content' | 'responsive' | 'brand';

export interface QACheck {
  id: string;
  category: QACategory;
  label: string;
  status: CheckStatus;
  message: string;
}

export interface QAReport {
  page: string;
  score: number; // 0–100
  passed: number;
  warned: number;
  failed: number;
  checks: QACheck[];
  isReady: boolean; // true if no failures
}

export interface QASummary {
  projectId: string;
  generatedAt: string;
  pages: QAReport[];
  overallScore: number;
  isReady: boolean;
  failedPages: string[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function pass(id: string, category: QACheck['category'], label: string, message = 'OK'): QACheck {
  return { id, category, label, status: 'pass', message };
}

export function warn(id: string, category: QACheck['category'], label: string, message: string): QACheck {
  return { id, category, label, status: 'warn', message };
}

export function fail(id: string, category: QACheck['category'], label: string, message: string): QACheck {
  return { id, category, label, status: 'fail', message };
}

function getAttr(html: string, tag: string, attr: string): string | null {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']*)["'][^>]*>`, 'i');
  return html.match(re)?.[1] ?? null;
}

function getMeta(html: string, name: string): string | null {
  const byName = html.match(new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'));
  if (byName) return byName[1];
  const byContent = html.match(new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*>`, 'i'));
  return byContent?.[1] ?? null;
}

function getOg(html: string, property: string): string | null {
  const re = new RegExp(`<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i');
  const m = html.match(re);
  if (m) return m[1];
  const re2 = new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["'][^>]*>`, 'i');
  return html.match(re2)?.[1] ?? null;
}

function countMatches(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function getInner(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return html.match(re)?.[1] ?? null;
}

function getAllAttrs(html: string, tag: string, attr: string): string[] {
  const re = new RegExp(`<${tag}[^>]*\\s${attr}=["']([^"']*)["'][^>]*>`, 'gi');
  const results: string[] = [];
  let m;
  while ((m = re.exec(html)) !== null) results.push(m[1]);
  return results;
}

function getImgTags(html: string): { src: string; alt: string | null }[] {
  const re = /<img([^>]*)>/gi;
  const imgs: { src: string; alt: string | null }[] = [];
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1];
    const src = attrs.match(/src=["']([^"']*)["']/i)?.[1] ?? '';
    const alt = attrs.match(/alt=["']([^"']*)["']/i)?.[1] ?? null;
    imgs.push({ src, alt });
  }
  return imgs;
}

// ─── Individual checks ────────────────────────────────────────────────────────

function checkHtmlLang(html: string): QACheck {
  const lang = html.match(/<html[^>]*\slang=["']([^"']*)["'][^>]*>/i)?.[1];
  if (!lang) return fail('html-lang', 'accessibility', 'HTML lang attribute', 'Missing lang attribute on <html>');
  if (lang.length < 2) return warn('html-lang', 'accessibility', 'HTML lang attribute', `lang="${lang}" looks invalid`);
  return pass('html-lang', 'accessibility', 'HTML lang attribute', `lang="${lang}"`);
}

function checkViewport(html: string): QACheck {
  const content = getMeta(html, 'viewport');
  if (!content) return fail('viewport', 'seo', 'Viewport meta tag', 'Missing <meta name="viewport">');
  if (!content.includes('width=device-width'))
    return warn('viewport', 'seo', 'Viewport meta tag', 'viewport should include width=device-width');
  return pass('viewport', 'seo', 'Viewport meta tag');
}

function checkTitle(html: string): QACheck {
  const title = getInner(html, 'title');
  if (!title) return fail('title', 'seo', '<title> tag', 'Missing <title> tag');
  const len = stripTags(title).length;
  if (len < 10) return fail('title', 'seo', '<title> tag', `Title too short (${len} chars). Minimum 10.`);
  if (len > 70) return warn('title', 'seo', '<title> tag', `Title too long (${len} chars). Keep under 70 for search snippets.`);
  return pass('title', 'seo', '<title> tag', `"${stripTags(title).slice(0, 50)}…" (${len} chars)`);
}

function checkDescription(html: string): QACheck {
  const desc = getMeta(html, 'description');
  if (!desc) return fail('meta-desc', 'seo', 'Meta description', 'Missing <meta name="description">');
  if (desc.length < 50) return warn('meta-desc', 'seo', 'Meta description', `Too short (${desc.length} chars). Aim for 50–160.`);
  if (desc.length > 160) return warn('meta-desc', 'seo', 'Meta description', `Too long (${desc.length} chars). Keep under 160.`);
  return pass('meta-desc', 'seo', 'Meta description', `${desc.length} chars`);
}

function checkCanonical(html: string): QACheck {
  const rel = html.match(/<link[^>]*rel=["']canonical["'][^>]*>/i);
  if (!rel) return warn('canonical', 'seo', 'Canonical URL', 'Missing <link rel="canonical">. Recommended for duplicate content prevention.');
  const href = rel[0].match(/href=["']([^"']*)["']/i)?.[1];
  if (!href || href === '/') return warn('canonical', 'seo', 'Canonical URL', 'Canonical href is empty or just "/"');
  return pass('canonical', 'seo', 'Canonical URL', href.slice(0, 60));
}

function checkOgTitle(html: string): QACheck {
  const val = getOg(html, 'title');
  if (!val) return fail('og-title', 'seo', 'og:title', 'Missing <meta property="og:title">');
  return pass('og-title', 'seo', 'og:title', `"${val.slice(0, 50)}"`);
}

function checkOgDescription(html: string): QACheck {
  const val = getOg(html, 'description');
  if (!val) return fail('og-desc', 'seo', 'og:description', 'Missing <meta property="og:description">');
  return pass('og-desc', 'seo', 'og:description');
}

function checkOgImage(html: string): QACheck {
  const val = getOg(html, 'image');
  if (!val) return warn('og-image', 'seo', 'og:image', 'Missing og:image. Social shares will have no preview image.');
  return pass('og-image', 'seo', 'og:image', val.slice(0, 60));
}

function checkOgType(html: string): QACheck {
  const val = getOg(html, 'type');
  if (!val) return warn('og-type', 'seo', 'og:type', 'Missing og:type (recommended: "website")');
  return pass('og-type', 'seo', 'og:type', val);
}

function checkJsonLd(html: string): QACheck {
  const scripts = html.match(/<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  if (!scripts || scripts.length === 0)
    return fail('jsonld', 'seo', 'JSON-LD structured data', 'Missing JSON-LD. Required for rich results in Google.');
  try {
    const content = scripts[0].replace(/<script[^>]*>|<\/script>/gi, '').trim();
    const parsed = JSON.parse(content);
    const type = parsed['@type'] ?? 'unknown';
    return pass('jsonld', 'seo', 'JSON-LD structured data', `@type: ${type}`);
  } catch {
    return warn('jsonld', 'seo', 'JSON-LD structured data', 'JSON-LD found but failed to parse. Check for syntax errors.');
  }
}

function checkH1(html: string): QACheck {
  const count = countMatches(html, /<h1[\s>]/gi);
  if (count === 0) return fail('h1', 'seo', '<h1> heading', 'No <h1> found. Every page needs exactly one.');
  if (count > 1) return fail('h1', 'seo', '<h1> heading', `Found ${count} <h1> tags. Should be exactly one per page.`);
  const content = stripTags(getInner(html, 'h1') ?? '');
  if (content.length < 3) return warn('h1', 'seo', '<h1> heading', 'H1 content seems too short.');
  return pass('h1', 'seo', '<h1> heading', `"${content.slice(0, 60)}"`);
}

function checkHeadingOrder(html: string): QACheck {
  const headings = [...html.matchAll(/<h([1-6])[\s>]/gi)].map(m => parseInt(m[1]));
  if (headings.length === 0) return warn('heading-order', 'accessibility', 'Heading hierarchy', 'No headings found.');
  for (let i = 1; i < headings.length; i++) {
    if (headings[i] > headings[i - 1] + 1) {
      return warn('heading-order', 'accessibility', 'Heading hierarchy',
        `Heading jumps from H${headings[i-1]} to H${headings[i]} — skipping levels harms screen readers.`);
    }
  }
  return pass('heading-order', 'accessibility', 'Heading hierarchy', `${headings.length} headings, correct order`);
}

function checkImgAlts(html: string): QACheck {
  const imgs = getImgTags(html);
  if (imgs.length === 0) return pass('img-alt', 'accessibility', 'Image alt attributes', 'No <img> tags found');
  const missing = imgs.filter(img => img.alt === null);
  const empty = imgs.filter(img => img.alt !== null && img.alt.trim() === '' && !img.src.includes('decorative'));
  if (missing.length > 0)
    return fail('img-alt', 'accessibility', 'Image alt attributes',
      `${missing.length} image(s) missing alt attribute completely.`);
  if (empty.length > 0)
    return warn('img-alt', 'accessibility', 'Image alt attributes',
      `${empty.length} image(s) have empty alt. OK only for decorative images.`);
  return pass('img-alt', 'accessibility', 'Image alt attributes', `All ${imgs.length} images have alt`);
}

function checkSkipLink(html: string): QACheck {
  const hasSkip = /<a[^>]*href=["']#(main|content|maincontent)["'][^>]*>/i.test(html);
  if (!hasSkip)
    return warn('skip-link', 'accessibility', 'Skip navigation link',
      'Missing skip link (e.g. <a href="#main">Skip to content</a>). Required for keyboard accessibility.');
  return pass('skip-link', 'accessibility', 'Skip navigation link');
}

function checkNavAria(html: string): QACheck {
  const navTags = html.match(/<nav[^>]*>/gi) ?? [];
  if (navTags.length === 0) return warn('nav-aria', 'accessibility', 'Navigation aria-label', 'No <nav> element found.');
  const missing = navTags.filter(tag => !/aria-label/i.test(tag));
  if (missing.length > 0)
    return warn('nav-aria', 'accessibility', 'Navigation aria-label',
      `${missing.length} <nav> element(s) missing aria-label. Multiple navs need labels to differentiate them.`);
  return pass('nav-aria', 'accessibility', 'Navigation aria-label', `${navTags.length} nav(s) labelled`);
}

function checkInteractiveAttrs(html: string): QACheck {
  // Check buttons without accessible text
  const buttons = [...html.matchAll(/<button([^>]*)>([\s\S]*?)<\/button>/gi)];
  const emptyButtons = buttons.filter(([, attrs, content]) => {
    const text = stripTags(content).trim();
    const hasAriaLabel = /aria-label/i.test(attrs);
    const hasAriaLabelledby = /aria-labelledby/i.test(attrs);
    return !text && !hasAriaLabel && !hasAriaLabelledby;
  });
  if (emptyButtons.length > 0)
    return warn('interactive', 'accessibility', 'Interactive element labels',
      `${emptyButtons.length} button(s) have no visible text or aria-label.`);
  return pass('interactive', 'accessibility', 'Interactive element labels');
}

function checkScrollBehavior(html: string): QACheck {
  const hasLenis = /lenis/i.test(html);
  const hasSmoothScroll = /scroll-behavior\s*:\s*smooth/i.test(html);
  const hasGsap = /gsap/i.test(html);
  if (!hasLenis && !hasSmoothScroll)
    return warn('scroll', 'structure', 'Smooth scroll', 'No smooth scroll detected. Consider adding scroll-behavior: smooth or Lenis.');
  if (hasLenis && !hasGsap)
    return warn('scroll', 'structure', 'Smooth scroll', 'Lenis found but GSAP not detected. Lenis without ScrollTrigger may cause sync issues.');
  return pass('scroll', 'structure', 'Smooth scroll', hasLenis ? 'Lenis + GSAP' : 'CSS scroll-behavior');
}

function checkAnimationContract(html: string): QACheck {
  const hasReducedMotion = /prefers-reduced-motion/i.test(html);
  const hasDataAnimate = /data-anim/i.test(html) || /\[data-a/i.test(html);
  if (!hasReducedMotion && hasDataAnimate)
    return fail('reduced-motion', 'accessibility', 'Reduced motion support',
      'Animations present but missing @media (prefers-reduced-motion). Required for users with vestibular disorders.');
  if (!hasReducedMotion)
    return warn('reduced-motion', 'accessibility', 'Reduced motion support',
      'No animation detected — add @media (prefers-reduced-motion) if you add animations later.');
  return pass('reduced-motion', 'accessibility', 'Reduced motion support');
}

function checkFavicon(html: string): QACheck {
  const hasFavicon = /<link[^>]*rel=["'][^"']*icon[^"']*["'][^>]*>/i.test(html);
  if (!hasFavicon)
    return warn('favicon', 'seo', 'Favicon', 'No favicon link found. Browsers and bookmarks rely on it.');
  return pass('favicon', 'seo', 'Favicon');
}

function checkDoctype(html: string): QACheck {
  if (!html.trim().toLowerCase().startsWith('<!doctype html>'))
    return fail('doctype', 'structure', 'DOCTYPE declaration', 'Missing <!DOCTYPE html>. Required for standards mode.');
  return pass('doctype', 'structure', 'DOCTYPE declaration');
}

function checkCharset(html: string): QACheck {
  const hasCharset = /<meta[^>]*charset=["']?utf-8["']?[^>]*>/i.test(html);
  if (!hasCharset)
    return fail('charset', 'structure', 'Charset declaration', 'Missing <meta charset="UTF-8">. Required to avoid encoding issues.');
  return pass('charset', 'structure', 'Charset declaration');
}

function checkExternalScripts(html: string): QACheck {
  const scripts = [...html.matchAll(/<script[^>]*src=["']([^"']*)["'][^>]*>/gi)].map(m => m[1]);
  const renderBlocking = scripts.filter(src => {
    // Scripts without defer/async in the <head> are render-blocking
    const tag = html.match(new RegExp(`<script[^>]*src=["']${src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`));
    if (!tag) return false;
    return !/defer|async/i.test(tag[0]);
  });
  if (renderBlocking.length > 0)
    return warn('scripts', 'performance', 'Non-blocking scripts',
      `${renderBlocking.length} script(s) missing defer/async. May block page render.`);
  return pass('scripts', 'performance', 'Non-blocking scripts', `${scripts.length} script(s) all deferred/async`);
}

function checkInlineStyles(html: string): QACheck {
  const inlineCount = countMatches(html, /style="[^"]+"/gi);
  if (inlineCount > 30)
    return warn('inline-styles', 'performance', 'Inline styles',
      `${inlineCount} inline style attributes. Excessive inline styles hurt maintainability and CSP.`);
  return pass('inline-styles', 'performance', 'Inline styles', `${inlineCount} inline style(s)`);
}

function checkResponsiveImages(html: string): QACheck {
  const imgs = getImgTags(html);
  if (imgs.length === 0) return pass('responsive-img', 'performance', 'Responsive images', 'No <img> tags');
  const withoutWidth = imgs.filter(img =>
    !img.src.includes('data:') &&
    !html.match(new RegExp(`<img[^>]*src=["']${img.src.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*(width|loading)=[^>]*>`))
  );
  if (withoutWidth.length > 3)
    return warn('responsive-img', 'performance', 'Responsive images',
      `${withoutWidth.length} images missing width/loading attributes. Add loading="lazy" for off-screen images.`);
  return pass('responsive-img', 'performance', 'Responsive images');
}

// ─── Main runner ──────────────────────────────────────────────────────────────

export function runQAOnPage(html: string, pageName: string): QAReport {
  const checks: QACheck[] = [
    // Structure
    checkDoctype(html),
    checkCharset(html),
    checkHtmlLang(html),
    checkViewport(html),
    // SEO
    checkTitle(html),
    checkDescription(html),
    checkCanonical(html),
    checkOgTitle(html),
    checkOgDescription(html),
    checkOgImage(html),
    checkOgType(html),
    checkJsonLd(html),
    checkFavicon(html),
    checkH1(html),
    // Accessibility
    checkHeadingOrder(html),
    checkImgAlts(html),
    checkSkipLink(html),
    checkNavAria(html),
    checkInteractiveAttrs(html),
    checkAnimationContract(html),
    // Performance
    checkScrollBehavior(html),
    checkExternalScripts(html),
    checkInlineStyles(html),
    checkResponsiveImages(html),
  ];

  const passed  = checks.filter(c => c.status === 'pass').length;
  const warned  = checks.filter(c => c.status === 'warn').length;
  const failed  = checks.filter(c => c.status === 'fail').length;
  const total   = checks.length;

  // Score: each pass = full points, warn = half, fail = 0
  const score = Math.round(((passed + warned * 0.5) / total) * 100);
  const isReady = failed === 0;

  return { page: pageName, score, passed, warned, failed, checks, isReady };
}

export function runQA(files: Record<string, string>, projectId: string): QASummary {
  // Check .html files (legacy) OR parse Base.astro as the SEO baseline for Astro projects
  const isAstroProject = Object.keys(files).some(k => k.endsWith('.astro'));

  let htmlFiles: [string, string][];
  if (isAstroProject) {
    // For Astro projects: run checks against Base.astro (contains all SEO infra)
    // and site.ts (contains business data). Map them to pseudo-HTML for checking.
    const baseAstro = files['src/layouts/Base.astro'] ?? '';
    const siteTs    = files['src/data/site.ts'] ?? '';
    // Combine so HTML-based checks can find meta tags + JSON-LD in Base.astro
    htmlFiles = [['index (Base.astro)', baseAstro + '\n' + siteTs]];
  } else {
    htmlFiles = Object.entries(files).filter(([name]) => name.endsWith('.html'));
  }

  const pages = htmlFiles.map(([name, html]) => runQAOnPage(html, name));

  const overallScore = pages.length > 0
    ? Math.round(pages.reduce((sum, p) => sum + p.score, 0) / pages.length)
    : 0;

  const failedPages = pages.filter(p => !p.isReady).map(p => p.page);

  return {
    projectId,
    generatedAt: new Date().toISOString(),
    pages,
    overallScore,
    isReady: failedPages.length === 0,
    failedPages,
  };
}

// ─── Human-readable report ────────────────────────────────────────────────────

export function formatQAReport(summary: QASummary): string {
  const statusIcon = (s: CheckStatus) => s === 'pass' ? '✓' : s === 'warn' ? '⚠' : '✗';
  const lines: string[] = [
    `QA Report — Project ${summary.projectId}`,
    `Generated: ${summary.generatedAt}`,
    `Overall score: ${summary.overallScore}/100 | Ready to deploy: ${summary.isReady ? 'YES' : 'NO'}`,
    '',
  ];

  for (const page of summary.pages) {
    lines.push(`── ${page.page} (${page.score}/100) ──────────────────`);
    lines.push(`  ✓ ${page.passed} passed  ⚠ ${page.warned} warnings  ✗ ${page.failed} failed`);
    lines.push('');

    const byCategory = page.checks.reduce((acc, c) => {
      if (!acc[c.category]) acc[c.category] = [];
      acc[c.category].push(c);
      return acc;
    }, {} as Record<string, QACheck[]>);

    for (const [cat, checks] of Object.entries(byCategory)) {
      lines.push(`  ${cat.toUpperCase()}`);
      for (const c of checks) {
        if (c.status !== 'pass') {
          lines.push(`  ${statusIcon(c.status)} ${c.label}: ${c.message}`);
        }
      }
    }
    lines.push('');
  }

  if (summary.failedPages.length > 0) {
    lines.push(`⚠ Pages with failures: ${summary.failedPages.join(', ')}`);
  }

  return lines.join('\n');
}
