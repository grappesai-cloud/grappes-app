// ─── Visual QA module ─────────────────────────────────────────────────────────
// Runs Puppeteer-based per-section layout checks on a live URL.
// Called automatically after every successful Vercel deployment.
// Results are stored back into generated_files so the QA API can serve them.

import { db } from './db';

export interface SectionIssue {
  type: string;
  severity: 'fail' | 'warn';
  message: string;
  details?: Array<{
    element: string;
    overRight: number;
    overLeft: number;
    overBottom: number;
  }>;
}

export interface SectionResult {
  selector: string;
  passed: boolean;
  height?: number;
  width?: number;
  opacity?: number;
  textLen?: number;
  issues: SectionIssue[];
  error?: string;
}

export interface ViewportResult {
  label: string;
  width: number;
  sections: SectionResult[];
  pageIssues: SectionIssue[];
}

export interface VisualQAReport {
  url: string;
  projectId: string;
  auditedAt: string;
  viewports: ViewportResult[];
  passed: boolean;
  failedSections: string[];
  totalChecked: number;
}

// ─── Browser-side section check (serialised and eval'd in Puppeteer) ──────────

const SECTION_CHECK = `
(function runSectionCheck(sectionSelector) {
  const section = document.querySelector(sectionSelector);
  if (!section) return { error: 'Element not found: ' + sectionSelector };

  const rect   = section.getBoundingClientRect();
  const style  = window.getComputedStyle(section);
  const issues = [];

  // 1. Visibility
  if (style.display === 'none' || style.visibility === 'hidden') {
    issues.push({ type: 'hidden', severity: 'fail',
      message: 'Section is not visible (display:none or visibility:hidden)' });
  }
  const opacity = parseFloat(style.opacity);
  if (opacity < 0.1) {
    issues.push({ type: 'invisible', severity: 'fail',
      message: 'Section opacity is ' + opacity + ' — content not visible' });
  }

  // 2. Height
  if (rect.height < 80) {
    issues.push({ type: 'collapsed', severity: 'fail',
      message: 'Section height is ' + Math.round(rect.height) + 'px — likely collapsed' });
  }

  // 3. Text content
  const text = section.innerText?.replace(/\\s+/g, ' ').trim() ?? '';
  if (text.length < 10) {
    issues.push({ type: 'empty', severity: 'fail',
      message: 'Section has almost no text content (' + text.length + ' chars)' });
  }

  // 4. Overflow — child elements exiting the section bounding box
  const TOLERANCE = 16;
  const overflows  = [];
  section.querySelectorAll('*').forEach(function(child) {
    const cRect = child.getBoundingClientRect();
    if (cRect.width === 0 || cRect.height === 0) return;
    const oRight  = cRect.right  - (rect.right  + TOLERANCE);
    const oLeft   = rect.left - TOLERANCE - cRect.left;
    const oBottom = cRect.bottom - (rect.bottom + TOLERANCE);
    if (oRight > 0 || oLeft > 0 || oBottom > 0) {
      const id  = child.id            ? '#' + child.id            : '';
      const cls = child.classList[0]  ? '.' + child.classList[0]  : '';
      overflows.push({
        element:    child.tagName.toLowerCase() + id + cls,
        overRight:  Math.round(Math.max(0, oRight)),
        overLeft:   Math.round(Math.max(0, oLeft)),
        overBottom: Math.round(Math.max(0, oBottom)),
      });
    }
  });
  if (overflows.length > 0) {
    issues.push({
      type: 'overflow', severity: 'fail',
      message: overflows.length + ' element(s) overflow the section bounds',
      details: overflows.slice(0, 8),
    });
  }

  // 5. Broken images
  const imgs   = [...section.querySelectorAll('img')];
  const broken = imgs.filter(function(img) { return !img.complete || img.naturalHeight === 0; });
  if (broken.length > 0) {
    issues.push({ type: 'broken-img', severity: 'warn',
      message: broken.length + ' image(s) failed to load' });
  }

  return {
    height:   Math.round(rect.height),
    width:    Math.round(rect.width),
    opacity:  opacity,
    textLen:  text.length,
    issues:   issues,
    passed:   !issues.some(function(i) { return i.severity === 'fail'; }),
  };
})
`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function scrollThrough(page: any) {
  const totalH = await page.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y <= totalH; y += 250) {
    await page.evaluate((y: number) => window.scrollTo(0, y), y);
    await new Promise(r => setTimeout(r, 60));
  }
  await page.evaluate(() => {
    ['[data-animate]', '[data-a]'].forEach(sel =>
      document.querySelectorAll(sel).forEach((el: any) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
      })
    );
    if ((window as any).ScrollTrigger) (window as any).ScrollTrigger.refresh();
  });
  await new Promise(r => setTimeout(r, 300));
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise(r => setTimeout(r, 200));
}

async function discoverSections(page: any): Promise<string[]> {
  return page.evaluate(() => {
    const selectors: string[] = [];
    const nav = document.querySelector('nav[aria-label]') || document.querySelector('nav');
    if (nav) selectors.push((nav as HTMLElement).id ? '#' + (nav as HTMLElement).id : 'nav');
    document.querySelectorAll('section[id]').forEach(s =>
      selectors.push('#' + (s as HTMLElement).id)
    );
    const footer = document.querySelector('footer');
    if (footer) selectors.push((footer as HTMLElement).id ? '#' + (footer as HTMLElement).id : 'footer');
    return [...new Set(selectors)];
  });
}

async function checkHorizontalScroll(page: any, viewportWidth: number): Promise<SectionIssue | null> {
  const scrollWidth: number = await page.evaluate(() => document.body.scrollWidth);
  if (scrollWidth > viewportWidth + 4) {
    return {
      type: 'horizontal-scroll',
      severity: 'fail',
      message: `Page scrollWidth ${scrollWidth}px exceeds viewport ${viewportWidth}px`,
    };
  }
  return null;
}

// ─── Duplicate section detection (pure HTML, no browser needed) ──────────────

export function detectDuplicateSections(html: string): SectionIssue[] {
  const matches = [...html.matchAll(/data-section="([^"]+)"/g)];
  const counts: Record<string, number> = {};
  for (const m of matches) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
  }
  return Object.entries(counts)
    .filter(([, count]) => count > 1)
    .map(([id, count]) => ({
      type: 'duplicate-section',
      severity: 'fail' as const,
      message: `Section "${id}" appears ${count} times — duplicate will break edit mode and layout`,
    }));
}

// ─── Pre-deploy QA — runs on raw HTML using page.setContent() ─────────────────
// No URL needed — Puppeteer loads HTML directly. Used immediately after generation.

export async function runVisualQAOnContent(params: {
  fullHtml: string;
  projectId: string;
}): Promise<VisualQAReport> {
  const { fullHtml, projectId } = params;

  let puppeteer: any;
  try {
    puppeteer = (await import('puppeteer' as string)).default;
  } catch {
    console.warn('[visual-qa] Puppeteer not available — skipping visual QA');
    return { url: '', projectId, auditedAt: new Date().toISOString(), viewports: [], passed: true, failedSections: [], totalChecked: 0 };
  }

  const VIEWPORTS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile',  width: 390,  height: 844 },
  ];

  const report: VisualQAReport = {
    url: 'content://(pre-deploy)',
    projectId,
    auditedAt: new Date().toISOString(),
    viewports: [],
    passed: true,
    failedSections: [],
    totalChecked: 0,
  };

  // Pure HTML check — duplicates detected before browser
  const duplicates = detectDuplicateSections(fullHtml);
  if (duplicates.length > 0) {
    report.passed = false;
    // Will be added to each viewport's pageIssues below
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });

      // Load HTML directly — no network needed
      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await new Promise(r => setTimeout(r, 800));

      // Force all animated elements visible (JS/GSAP won't run without CDN)
      await page.evaluate(() => {
        document.querySelectorAll('[data-animate], [data-anim]').forEach((el: any) => {
          el.style.opacity = '1';
          el.style.transform = 'none';
          el.style.visibility = 'visible';
        });
      });
      await new Promise(r => setTimeout(r, 200));

      const vpResult: ViewportResult = {
        label: vp.label,
        width: vp.width,
        sections: [],
        pageIssues: [...duplicates],
      };

      // Global: horizontal scroll
      const hScroll = await checkHorizontalScroll(page, vp.width);
      if (hScroll) {
        vpResult.pageIssues.push(hScroll);
        report.passed = false;
      }

      // Per-section checks
      const selectors = await discoverSections(page);
      report.totalChecked += selectors.length;

      for (const selector of selectors) {
        const result: any = await page.evaluate(
          new Function('sectionSelector', `return (${SECTION_CHECK})(sectionSelector)`),
          selector
        );

        const sectionResult: SectionResult = {
          selector,
          passed: result.passed ?? false,
          height:  result.height,
          width:   result.width,
          opacity: result.opacity,
          textLen: result.textLen,
          issues:  result.issues ?? [],
          error:   result.error,
        };

        // Skip broken-img check in pre-deploy mode (no network to load images)
        sectionResult.issues = sectionResult.issues.filter(
          (i: SectionIssue) => i.type !== 'broken-img'
        );
        sectionResult.passed = !sectionResult.issues.some(
          (i: SectionIssue) => i.severity === 'fail'
        );

        vpResult.sections.push(sectionResult);

        if (!sectionResult.passed && !sectionResult.error) {
          report.passed = false;
          const key = `${vp.label}:${selector}`;
          if (!report.failedSections.includes(key)) {
            report.failedSections.push(key);
          }
        }
      }

      report.viewports.push(vpResult);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  console.log(
    `[visual-qa] Pre-deploy check: ${report.passed ? 'PASSED' : 'FAILED'} — ${report.failedSections.length} failed section(s)`
  );

  return report;
}

// ─── Main export ───────────────────────────────────────────────────────────────

export async function runVisualQA(projectId: string, url: string): Promise<VisualQAReport> {
  // Dynamic import — puppeteer is a dev/optional dependency
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let puppeteer: any;
  try {
    // @ts-ignore — optional peer dependency
    puppeteer = (await import('puppeteer' as string)).default;
  } catch {
    console.warn('[visual-qa] Puppeteer not available — skipping visual QA');
    return { url, projectId, auditedAt: new Date().toISOString(), viewports: [], passed: true, failedSections: [], totalChecked: 0 };
  }

  const VIEWPORTS = [
    { label: 'desktop', width: 1440, height: 900 },
    { label: 'mobile',  width: 390,  height: 844 },
  ];

  const report: VisualQAReport = {
    url,
    projectId,
    auditedAt: new Date().toISOString(),
    viewports: [],
    passed: true,
    failedSections: [],
    totalChecked: 0,
  };

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await page.goto(url, { waitUntil: 'networkidle0', timeout: 60_000 });
      await new Promise(r => setTimeout(r, 1500));
      await scrollThrough(page);

      const vpResult: ViewportResult = {
        label: vp.label,
        width: vp.width,
        sections: [],
        pageIssues: [],
      };

      // Global: horizontal scroll
      const hScroll = await checkHorizontalScroll(page, vp.width);
      if (hScroll) {
        vpResult.pageIssues.push(hScroll);
        report.passed = false;
      }

      // Per-section checks
      const selectors = await discoverSections(page);
      report.totalChecked += selectors.length;

      for (const selector of selectors) {
        const result: any = await page.evaluate(
          new Function('sectionSelector', `return (${SECTION_CHECK})(sectionSelector)`),
          selector
        );

        const sectionResult: SectionResult = {
          selector,
          passed: result.passed ?? false,
          height: result.height,
          width:  result.width,
          opacity: result.opacity,
          textLen: result.textLen,
          issues:  result.issues ?? [],
          error:   result.error,
        };

        vpResult.sections.push(sectionResult);

        if (!sectionResult.passed && !sectionResult.error) {
          report.passed = false;
          const key = `${vp.label}:${selector}`;
          if (!report.failedSections.includes(key)) {
            report.failedSections.push(key);
          }
        }
      }

      report.viewports.push(vpResult);
      await page.close();
    }
  } finally {
    await browser.close();
  }

  // ── Persist results into generated_files so API can serve them ───────────────
  try {
    const latest = await db.generatedFiles.findLatest(projectId);
    if (latest) {
      const updatedFiles = {
        ...latest.files,
        '__visual-qa.json': JSON.stringify(report, null, 2),
      };
      // Re-use the create method with same version to update files record
      // (Supabase upsert on project_id + version)
      await db.generatedFiles.upsertQAReport(projectId, latest.version, updatedFiles);
    }
  } catch (e) {
    console.error('[visual-qa] Failed to persist results:', e);
  }

  return report;
}

// ─── Capture screenshots of specific sections from raw HTML ──────────────────

export async function captureFailedSectionScreenshots(params: {
  fullHtml: string;
  sectionIds: string[];
}): Promise<Record<string, { desktop: string | null; mobile: string | null }>> {
  const { fullHtml, sectionIds } = params;

  let puppeteer: any;
  try {
    puppeteer = (await import('puppeteer' as string)).default;
  } catch {
    console.warn('[visual-qa] Puppeteer not available — skipping section screenshots');
    const empty: Record<string, { desktop: string | null; mobile: string | null }> = {};
    for (const id of sectionIds) empty[id] = { desktop: null, mobile: null };
    return empty;
  }

  const VIEWPORTS = [
    { label: 'desktop' as const, width: 1440, height: 900 },
    { label: 'mobile' as const,  width: 390,  height: 844 },
  ];

  const result: Record<string, { desktop: string | null; mobile: string | null }> = {};
  for (const id of sectionIds) {
    result[id] = { desktop: null, mobile: null };
  }

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    for (const vp of VIEWPORTS) {
      const page = await browser.newPage();
      await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: 1 });
      await page.setContent(fullHtml, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await new Promise(r => setTimeout(r, 800));

      // Force animated elements visible
      await page.evaluate(() => {
        document.querySelectorAll('[data-animate], [data-anim]').forEach((el: any) => {
          el.style.opacity = '1';
          el.style.transform = 'none';
          el.style.visibility = 'visible';
        });
      });
      await new Promise(r => setTimeout(r, 200));

      for (const sectionId of sectionIds) {
        try {
          const selector = `#${sectionId}, [data-section="${sectionId}"]`;
          const element = await page.$(selector);
          if (!element) continue;

          // Scroll to the section
          await page.evaluate(
            (sel: string) => {
              const el = document.querySelector(sel);
              if (el) el.scrollIntoView({ block: 'start' });
            },
            selector
          );
          await new Promise(r => setTimeout(r, 300));

          // Take a screenshot of the element as base64 JPEG
          const screenshotBuffer = await element.screenshot({
            type: 'jpeg',
            quality: 75,
            encoding: 'base64',
          });

          result[sectionId][vp.label] = screenshotBuffer as string;
        } catch (err) {
          console.warn(`[visual-qa] Failed to capture ${vp.label} screenshot for "${sectionId}":`, err);
        }
      }

      await page.close();
    }
  } finally {
    await browser.close();
  }

  return result;
}

// ─── Formatter for human-readable output ──────────────────────────────────────

export function formatVisualQAReport(report: VisualQAReport): string {
  const lines: string[] = [
    `Visual QA — ${report.url}`,
    `Audited:  ${report.auditedAt}`,
    `Result:   ${report.passed ? '✓ ALL PASS' : '✗ ISSUES FOUND'}`,
    '',
  ];

  for (const vp of report.viewports) {
    lines.push(`── ${vp.label.toUpperCase()} (${vp.width}px) ────────────────────────`);

    for (const issue of vp.pageIssues) {
      lines.push(`  ✗ [page] ${issue.message}`);
    }

    for (const s of vp.sections) {
      if (s.error) {
        lines.push(`  ? [${s.selector}] ${s.error}`);
        continue;
      }
      const icon = s.passed ? '✓' : '✗';
      lines.push(`  ${icon} [${s.selector}] h=${s.height}px`);
      for (const issue of s.issues) {
        lines.push(`       → ${issue.message}`);
        if (issue.details) {
          issue.details.forEach(d =>
            lines.push(`         ${d.element}: right+${d.overRight}px left+${d.overLeft}px bottom+${d.overBottom}px`)
          );
        }
      }
    }
    lines.push('');
  }

  if (report.failedSections.length > 0) {
    lines.push(`Failed sections: ${report.failedSections.join(', ')}`);
  }

  return lines.join('\n');
}

// ─── Simplified page-level visual QA (Phase 1) ──────────────────────────────
// Launches Puppeteer, loads HTML, takes screenshots at two viewports,
// and runs page-level overflow + content checks. No per-section analysis.

export interface PageVisualQAResult {
  passed: boolean;
  issues: string[];
  screenshots: {
    desktop: string; // base64 JPEG
    mobile: string;  // base64 JPEG
  };
}

export async function runPageVisualQA(html: string): Promise<PageVisualQAResult> {
  let puppeteer: any;
  try {
    puppeteer = (await import('puppeteer' as string)).default;
  } catch {
    console.warn('[visual-qa] Puppeteer not available — skipping page visual QA');
    return { passed: true, issues: [], screenshots: { desktop: '', mobile: '' } };
  }

  const issues: string[] = [];
  const screenshots: { desktop: string; mobile: string } = { desktop: '', mobile: '' };

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });

  try {
    // ── Desktop viewport ──────────────────────────────────────────────────
    const desktopPage = await browser.newPage();
    await desktopPage.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await desktopPage.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 800));

    // Force animated elements visible
    await desktopPage.evaluate(() => {
      document.querySelectorAll('[data-animate], [data-anim], [style*="opacity: 0"], [style*="opacity:0"]').forEach((el: any) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.visibility = 'visible';
      });
    });
    await new Promise(r => setTimeout(r, 200));

    // Check: horizontal overflow
    const desktopOverflow: boolean = await desktopPage.evaluate(() => {
      return document.body.scrollWidth > document.documentElement.clientWidth + 4;
    });
    if (desktopOverflow) {
      const scrollWidth: number = await desktopPage.evaluate(() => document.body.scrollWidth);
      issues.push(`Desktop horizontal overflow: scrollWidth ${scrollWidth}px > viewport 1440px`);
    }

    // Check: has content (body height > 200px)
    const desktopHeight: number = await desktopPage.evaluate(() => document.body.scrollHeight);
    if (desktopHeight < 200) {
      issues.push(`Desktop body height only ${desktopHeight}px — page appears empty`);
    }

    // Take full-page screenshot
    const desktopScreenshot = await desktopPage.screenshot({
      type: 'jpeg',
      quality: 75,
      fullPage: true,
      encoding: 'base64',
    });
    screenshots.desktop = desktopScreenshot as string;
    await desktopPage.close();

    // ── Mobile viewport ───────────────────────────────────────────────────
    const mobilePage = await browser.newPage();
    await mobilePage.setViewport({ width: 390, height: 844, deviceScaleFactor: 1 });
    await mobilePage.setContent(html, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await new Promise(r => setTimeout(r, 800));

    // Force animated elements visible
    await mobilePage.evaluate(() => {
      document.querySelectorAll('[data-animate], [data-anim], [style*="opacity: 0"], [style*="opacity:0"]').forEach((el: any) => {
        el.style.opacity = '1';
        el.style.transform = 'none';
        el.style.visibility = 'visible';
      });
    });
    await new Promise(r => setTimeout(r, 200));

    // Check: horizontal overflow on mobile
    const mobileOverflow: boolean = await mobilePage.evaluate(() => {
      return document.body.scrollWidth > document.documentElement.clientWidth + 4;
    });
    if (mobileOverflow) {
      const mobileScrollWidth: number = await mobilePage.evaluate(() => document.body.scrollWidth);
      issues.push(`Mobile horizontal overflow: scrollWidth ${mobileScrollWidth}px > viewport 390px`);
    }

    // Check: has content on mobile
    const mobileHeight: number = await mobilePage.evaluate(() => document.body.scrollHeight);
    if (mobileHeight < 200) {
      issues.push(`Mobile body height only ${mobileHeight}px — page appears empty`);
    }

    // Take full-page screenshot
    const mobileScreenshot = await mobilePage.screenshot({
      type: 'jpeg',
      quality: 75,
      fullPage: true,
      encoding: 'base64',
    });
    screenshots.mobile = mobileScreenshot as string;
    await mobilePage.close();

  } finally {
    await browser.close();
  }

  const passed = issues.length === 0;

  console.log(
    `[visual-qa] Page-level check: ${passed ? 'PASSED' : 'FAILED'} — ${issues.length} issue(s)`
  );

  return { passed, issues, screenshots };
}
