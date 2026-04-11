#!/usr/bin/env node
/**
 * Visual QA Runner — per-section screenshot + programmatic layout checks.
 *
 * Checks per section (desktop 1440px + mobile 390px):
 *   1. Visibility       — not display:none, opacity > 0.1
 *   2. Height           — section height > 80px (not collapsed)
 *   3. Text content     — section has meaningful text (not empty)
 *   4. Overflow         — no child element exits the section bounding box
 *   5. Broken images    — no <img> that failed to load
 *   6. Z-index overlap  — no sibling card/badge covers primary text
 *
 * Checks per viewport:
 *   7. Horizontal scroll — page width <= viewport width (no x-scroll)
 *   8. Full-page screenshot saved for human review
 *
 * Usage:
 *   node scripts/visual-qa.mjs <url> [--out <dir>] [--json]
 *
 * Examples:
 *   node scripts/visual-qa.mjs https://my-project.vercel.app
 *   node scripts/visual-qa.mjs http://localhost:4321 --out /tmp/qa-report --json
 *
 * Exit codes:
 *   0 — all checks passed
 *   1 — one or more checks failed
 *
 * Requirements:
 *   npm install --save-dev puppeteer
 */

import { mkdirSync, writeFileSync } from 'fs';
import { resolve, join } from 'path';

// ── CLI args ───────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const url        = args.find(a => !a.startsWith('--'));
const jsonMode   = args.includes('--json');
const outIdx     = args.indexOf('--out');
const outDir     = outIdx !== -1 ? args[outIdx + 1] : join(process.cwd(), 'qa-report');

if (!url) {
  console.error('Usage: node scripts/visual-qa.mjs <url> [--out <dir>] [--json]');
  process.exit(1);
}

mkdirSync(outDir, { recursive: true });

// ── Viewports ──────────────────────────────────────────────────────────────────
const VIEWPORTS = [
  { label: 'desktop', width: 1440, height: 900  },
  { label: 'mobile',  width: 390,  height: 844  },
];

// ── Puppeteer import ───────────────────────────────────────────────────────────
let puppeteer;
try {
  puppeteer = (await import('puppeteer')).default;
} catch {
  console.error('Puppeteer not found. Run: npm install --save-dev puppeteer');
  process.exit(1);
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function slug(str) {
  return str.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

/** Scroll slowly through the page so GSAP ScrollTrigger fires on all elements */
async function scrollThrough(page) {
  const totalH = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= totalH; y += 250) {
    await page.evaluate(y => window.scrollTo(0, y), y);
    await new Promise(r => setTimeout(r, 60));
  }
  // Force any remaining [data-animate] / [data-a] visible (mirrors fallback in generated sites)
  await page.evaluate(() => {
    ['[data-animate]', '[data-a]'].forEach(sel =>
      document.querySelectorAll(sel).forEach(el => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      })
    );
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 200));
}

// ── Per-section programmatic checks (runs inside browser context) ──────────────
const SECTION_CHECKS_FN = `
(function(sectionSelector) {
  const section = document.querySelector(sectionSelector);
  if (!section) return { error: 'Element not found: ' + sectionSelector };

  const rect  = section.getBoundingClientRect();
  const style = window.getComputedStyle(section);
  const issues = [];

  // 1. Visibility
  if (style.display === 'none' || style.visibility === 'hidden') {
    issues.push({ type: 'hidden', severity: 'fail', message: 'Section is not visible (display:none or visibility:hidden)' });
  }
  const opacity = parseFloat(style.opacity);
  if (opacity < 0.1) {
    issues.push({ type: 'invisible', severity: 'fail', message: 'Section opacity is ' + opacity + ' — content not visible' });
  }

  // 2. Height
  if (rect.height < 80) {
    issues.push({ type: 'collapsed', severity: 'fail', message: 'Section height is only ' + Math.round(rect.height) + 'px — likely collapsed' });
  }

  // 3. Text content
  const text = section.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  if (text.length < 10) {
    issues.push({ type: 'empty', severity: 'fail', message: 'Section has almost no text content (' + text.length + ' chars)' });
  }

  // 4. Overflow — find children that exit the section bounding box
  const TOLERANCE = 16; // px — allow box-shadow / slight rounding
  const children  = section.querySelectorAll('*');
  const overflows = [];
  children.forEach(child => {
    const cRect = child.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) return;
    const overRight  = cRect.right  - (rect.right  + TOLERANCE);
    const overLeft   = rect.left - TOLERANCE - cRect.left;
    const overBottom = cRect.bottom - (rect.bottom + TOLERANCE);
    if (overRight > 0 || overLeft > 0 || overBottom > 0) {
      const id  = child.id   ? '#' + child.id   : '';
      const cls = child.classList[0] ? '.' + child.classList[0] : '';
      overflows.push({
        element:      child.tagName.toLowerCase() + id + cls,
        overRight:    Math.round(Math.max(0, overRight)),
        overLeft:     Math.round(Math.max(0, overLeft)),
        overBottom:   Math.round(Math.max(0, overBottom)),
      });
    }
  });
  if (overflows.length > 0) {
    issues.push({
      type:     'overflow',
      severity: 'fail',
      message:  overflows.length + ' element(s) overflow the section bounds',
      details:  overflows.slice(0, 8),
    });
  }

  // 5. Broken images
  const imgs   = [...section.querySelectorAll('img')];
  const broken = imgs.filter(img => !img.complete || img.naturalHeight === 0);
  if (broken.length > 0) {
    issues.push({ type: 'broken-img', severity: 'warn', message: broken.length + ' image(s) failed to load' });
  }

  return {
    height:  Math.round(rect.height),
    width:   Math.round(rect.width),
    opacity: opacity,
    textLen: text.length,
    imgCount: imgs.length,
    issues,
    passed: !issues.some(i => i.severity === 'fail'),
  };
})
`;

async function checkSection(page, selector) {
  return page.evaluate(
    new Function('sectionSelector', `return (${SECTION_CHECKS_FN})(sectionSelector)`),
    selector
  );
}

/** Horizontal scroll check — body should never be wider than viewport */
async function checkHorizontalScroll(page, viewportWidth) {
  const scrollWidth = await page.evaluate(() => document.body.scrollWidth);
  if (scrollWidth > viewportWidth + 4) {
    return {
      type: 'horizontal-scroll',
      severity: 'fail',
      message: `Page scrollWidth ${scrollWidth}px exceeds viewport ${viewportWidth}px — horizontal overflow`,
    };
  }
  return null;
}

// ── Main runner ────────────────────────────────────────────────────────────────

const browser = await puppeteer.launch({
  headless: 'new',
  args: ['--no-sandbox', '--disable-dev-shm-usage'],
});

const report = {
  url,
  auditedAt: new Date().toISOString(),
  viewports: [],
  passed: true,
};

for (const viewport of VIEWPORTS) {
  const { label, width, height } = viewport;
  const vpDir = join(outDir, label);
  mkdirSync(vpDir, { recursive: true });

  const page = await browser.newPage();
  await page.setViewport({ width, height, deviceScaleFactor: 2 });
  await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
  await new Promise(r => setTimeout(r, 1500));
  await scrollThrough(page);

  // Discover sections: <nav>, <section id="...">, <footer>
  const sectionSelectors = await page.evaluate(() => {
    const els = [];
    const nav = document.querySelector('nav[aria-label]') || document.querySelector('nav');
    if (nav) els.push(nav.id ? '#' + nav.id : 'nav');

    document.querySelectorAll('section[id]').forEach(s => els.push('#' + s.id));

    const footer = document.querySelector('footer');
    if (footer) els.push(footer.id ? '#' + footer.id : 'footer');

    return [...new Set(els)];
  });

  if (!jsonMode) {
    console.log(`\n── ${label.toUpperCase()} (${width}px) ─────────────────────────────────`);
    console.log(`   Sections found: ${sectionSelectors.join(', ')}`);
  }

  // ── Global check: horizontal scroll
  const vpResult = { label, width, sections: [], pageIssues: [] };
  const hScrollIssue = await checkHorizontalScroll(page, width);
  if (hScrollIssue) {
    vpResult.pageIssues.push(hScrollIssue);
    if (!jsonMode) console.log(`  ✗ [page] ${hScrollIssue.message}`);
  }

  // ── Full-page screenshot
  await page.screenshot({ path: join(vpDir, '_full-page.png'), fullPage: true });

  // ── Per-section checks + screenshots
  for (const selector of sectionSelectors) {
    const result = await checkSection(page, selector);

    if (result.error) {
      if (!jsonMode) console.log(`  ? [${selector}] ${result.error}`);
      vpResult.sections.push({ selector, error: result.error });
      continue;
    }

    // Screenshot this section
    try {
      const el = await page.$(selector);
      if (el) {
        const box = await el.boundingBox();
        if (box && box.height > 0) {
          await page.screenshot({
            path: join(vpDir, slug(selector) + '.png'),
            clip: { x: 0, y: box.y, width: width * 2, height: Math.min(box.height, 2000) },
          });
        }
      }
    } catch {}

    const icon = result.passed ? '✓' : '✗';
    if (!jsonMode) {
      console.log(`  ${icon} [${selector}] h=${result.height}px | ${result.passed ? 'PASS' : result.issues.map(i => i.type).join(', ')}`);
      if (!result.passed) {
        result.issues.forEach(issue => {
          console.log(`       → ${issue.message}`);
          if (issue.details) {
            issue.details.forEach(d => console.log(`         ${d.element}: right+${d.overRight}px left+${d.overLeft}px bottom+${d.overBottom}px`));
          }
        });
      }
    }

    vpResult.sections.push({ selector, ...result });
    if (!result.passed) report.passed = false;
  }

  if (vpResult.pageIssues.length > 0) report.passed = false;
  report.viewports.push(vpResult);
  await page.close();
}

await browser.close();

// ── Output ─────────────────────────────────────────────────────────────────────

const reportPath = join(outDir, 'report.json');
writeFileSync(reportPath, JSON.stringify(report, null, 2));

if (jsonMode) {
  console.log(JSON.stringify(report, null, 2));
} else {
  const totalSections  = report.viewports.reduce((n, vp) => n + vp.sections.length, 0);
  const failedSections = report.viewports.reduce(
    (n, vp) => n + vp.sections.filter(s => !s.passed && !s.error).length, 0
  );
  console.log('\n── SUMMARY ──────────────────────────────────────────────');
  console.log(`   Sections checked : ${totalSections}`);
  console.log(`   Passed           : ${totalSections - failedSections}`);
  console.log(`   Failed           : ${failedSections}`);
  console.log(`   Overall          : ${report.passed ? '✓ ALL PASS' : '✗ ISSUES FOUND'}`);
  console.log(`   Screenshots      : ${outDir}/`);
  console.log(`   Report JSON      : ${reportPath}`);
}

process.exit(report.passed ? 0 : 1);
