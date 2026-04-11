// ─── Structural QA ───────────────────────────────────────────────────────────
// Lightweight HTML structure checks: 10 essential checks for SEO, accessibility,
// and basic HTML correctness. Runs inline after generation — no browser needed.
// Replaces the heavier qa.ts + qa-modules/ system.

// ─── Types ───────────────────────────────────────────────────────────────────

export interface QACheck {
  name: string;
  passed: boolean;
  message: string;
}

export interface QAReport {
  checks: QACheck[];
  passed: boolean;
  score: number; // percentage of checks passed
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getMeta(html: string, name: string): string | null {
  // Match name="X" content="Y" (either order)
  const byName = html.match(
    new RegExp(`<meta[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i')
  );
  if (byName) return byName[1];

  const byContent = html.match(
    new RegExp(`<meta[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*>`, 'i')
  );
  return byContent?.[1] ?? null;
}

function getOg(html: string, property: string): string | null {
  const re = new RegExp(
    `<meta[^>]*property=["']og:${property}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'
  );
  const m = html.match(re);
  if (m) return m[1];

  const re2 = new RegExp(
    `<meta[^>]*content=["']([^"']*)["'][^>]*property=["']og:${property}["'][^>]*>`, 'i'
  );
  return html.match(re2)?.[1] ?? null;
}

function getInner(html: string, tag: string): string | null {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  return html.match(re)?.[1] ?? null;
}

function stripTags(s: string): string {
  return s.replace(/<[^>]+>/g, '').trim();
}

function countMatches(html: string, re: RegExp): number {
  return (html.match(re) ?? []).length;
}

// ─── Individual Checks ──────────────────────────────────────────────────────

function checkDoctype(html: string): QACheck {
  const passed = html.trim().toLowerCase().startsWith('<!doctype html>');
  return {
    name: 'DOCTYPE',
    passed,
    message: passed
      ? '<!DOCTYPE html> present'
      : 'Missing <!DOCTYPE html> — required for standards mode',
  };
}

function checkCharset(html: string): QACheck {
  const passed = /<meta[^>]*charset=["']?utf-8["']?[^>]*>/i.test(html);
  return {
    name: 'UTF-8 charset',
    passed,
    message: passed
      ? 'UTF-8 charset declared'
      : 'Missing <meta charset="UTF-8">',
  };
}

function checkHtmlLang(html: string): QACheck {
  const lang = html.match(/<html[^>]*\slang=["']([^"']*)["'][^>]*>/i)?.[1];
  const passed = !!lang && lang.length >= 2;
  return {
    name: 'HTML lang attribute',
    passed,
    message: passed
      ? `lang="${lang}"`
      : 'Missing or invalid lang attribute on <html>',
  };
}

function checkViewport(html: string): QACheck {
  const content = getMeta(html, 'viewport');
  const passed = !!content && content.includes('width=device-width');
  return {
    name: 'Viewport meta tag',
    passed,
    message: passed
      ? 'Viewport meta tag present with width=device-width'
      : 'Missing or incomplete <meta name="viewport">',
  };
}

function checkTitle(html: string): QACheck {
  const title = getInner(html, 'title');
  if (!title) {
    return { name: 'Title tag', passed: false, message: 'Missing <title> tag' };
  }
  const len = stripTags(title).length;
  const passed = len >= 10 && len <= 70;
  return {
    name: 'Title tag',
    passed,
    message: passed
      ? `Title: "${stripTags(title).slice(0, 50)}${len > 50 ? '...' : ''}" (${len} chars)`
      : `Title length ${len} chars — should be 10-70 chars`,
  };
}

function checkMetaDescription(html: string): QACheck {
  const desc = getMeta(html, 'description');
  if (!desc) {
    return { name: 'Meta description', passed: false, message: 'Missing <meta name="description">' };
  }
  const passed = desc.length >= 50 && desc.length <= 160;
  return {
    name: 'Meta description',
    passed,
    message: passed
      ? `Meta description: ${desc.length} chars`
      : `Meta description ${desc.length} chars — should be 50-160 chars`,
  };
}

function checkH1(html: string): QACheck {
  const count = countMatches(html, /<h1[\s>]/gi);
  const passed = count === 1;
  return {
    name: 'Single H1',
    passed,
    message: passed
      ? 'Exactly one <h1> tag found'
      : count === 0
        ? 'No <h1> found — every page needs exactly one'
        : `Found ${count} <h1> tags — should be exactly one`,
  };
}

function checkOgTitle(html: string): QACheck {
  const val = getOg(html, 'title');
  const passed = !!val && val.length > 0;
  return {
    name: 'og:title',
    passed,
    message: passed
      ? `og:title: "${val!.slice(0, 50)}"`
      : 'Missing <meta property="og:title">',
  };
}

function checkOgDescription(html: string): QACheck {
  const val = getOg(html, 'description');
  const passed = !!val && val.length > 0;
  return {
    name: 'og:description',
    passed,
    message: passed
      ? 'og:description present'
      : 'Missing <meta property="og:description">',
  };
}

function checkImgAlts(html: string): QACheck {
  // Find all <img> tags and check for alt attributes
  const imgRegex = /<img([^>]*)>/gi;
  const imgs: string[] = [];
  let m;
  while ((m = imgRegex.exec(html)) !== null) {
    imgs.push(m[1]);
  }

  if (imgs.length === 0) {
    return { name: 'Image alt attributes', passed: true, message: 'No <img> tags found' };
  }

  const missingAlt = imgs.filter(attrs => !/\balt=/i.test(attrs));
  const passed = missingAlt.length === 0;

  return {
    name: 'Image alt attributes',
    passed,
    message: passed
      ? `All ${imgs.length} images have alt attributes`
      : `${missingAlt.length} of ${imgs.length} image(s) missing alt attribute`,
  };
}

// ─── Main Runner ─────────────────────────────────────────────────────────────

export function runStructuralQA(html: string): QAReport {
  const checks: QACheck[] = [
    checkDoctype(html),
    checkCharset(html),
    checkHtmlLang(html),
    checkViewport(html),
    checkTitle(html),
    checkMetaDescription(html),
    checkH1(html),
    checkOgTitle(html),
    checkOgDescription(html),
    checkImgAlts(html),
  ];

  const passedCount = checks.filter(c => c.passed).length;
  const score = Math.round((passedCount / checks.length) * 100);

  return {
    checks,
    passed: passedCount === checks.length,
    score,
  };
}
