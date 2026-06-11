// ── Audit screenshot capture ──────────────────────────────────────────────────
// Puppeteer-based capture for the Attention lens. Unlike the PSI screenshot
// (mobile-only, can't interact), this drives a real browser so we can:
//   1. dismiss the cookie / consent banner before shooting (else every shot is
//      buried under a "We value your privacy" overlay),
//   2. capture BOTH desktop (1440) and mobile (390) above-the-fold,
//   3. reuse one browser context across pages — once consent is given on the
//      first page it persists site-wide, so the banner never reappears.
//
// Screenshots are returned as base64 JPEG (no data: prefix). The orchestrator
// sends them to the vision model and uploads them to Blob; nothing here touches
// the DB.

import { launchBrowser } from './browser';

export interface PageCapture {
  url: string;
  title: string;
  heroText: string;
  desktop: string | null; // base64 JPEG (above-the-fold @ 1440)
  mobile: string | null;  // base64 JPEG (above-the-fold @ 390)
  error?: string;
}

const DESKTOP_VP = { width: 1440, height: 900, deviceScaleFactor: 1 };
const MOBILE_VP = { width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true };

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// Known one-click "accept all" selectors for the big consent platforms.
const COOKIE_SELECTORS = [
  '#onetrust-accept-btn-handler',                                    // OneTrust
  '#CybotCookiebotDialogBodyLevelButtonLevelOptinAllowAll',          // Cookiebot
  '#CybotCookiebotDialogBodyButtonAccept',                           // Cookiebot (alt)
  'button#hs-eu-confirmation-button',                                // HubSpot
  '[data-cookiebanner="accept_button"]',                            // Facebook/Meta
  '[aria-label="Accept all"]',
  '[aria-label="Accept all cookies"]',
  '.cc-allow', '.cc-dismiss',                                        // Cookie Consent (Osano)
  '.cookie-accept', '.cookies-accept', '.accept-cookies',
  '#accept-cookies', '#acceptCookies', '#cookie-accept',
  '.js-accept-cookies', '.qc-cmp2-summary-buttons button[mode="primary"]', // Quantcast
  '#truste-consent-button',                                          // TrustArc
];

// Text-based fallback — clicks the first visible button/link whose label is a
// plain "accept" affirmation (EN + RO). Kept tight so we never click "Settings"
// or "Reject".
const COOKIE_TEXT_RX =
  /^(accept all|accept all cookies|allow all|allow all cookies|accept cookies|accept|i accept|agree|i agree|got it|ok|okay|allow cookies|sunt de acord|de acord|accept(ă|a)? (toate|tot)|permite (toate|tot)|sunt de acord cu toate|am ?înțeles)$/i;

async function dismissCookies(page: any): Promise<void> {
  try {
    for (const sel of COOKIE_SELECTORS) {
      const el = await page.$(sel).catch(() => null);
      if (el) {
        await el.click().catch(() => {});
        await sleep(250);
        return;
      }
    }
    // Text fallback in-page.
    await page.evaluate((rxSource: string) => {
      const rx = new RegExp(rxSource, 'i');
      const nodes = Array.from(
        document.querySelectorAll('button, a, [role="button"], input[type="button"], input[type="submit"]'),
      ) as HTMLElement[];
      for (const n of nodes) {
        const txt = (n.innerText || (n as HTMLInputElement).value || '').trim();
        if (!txt || txt.length > 40) continue;
        if (rx.test(txt)) {
          const r = n.getBoundingClientRect();
          if (r.width > 0 && r.height > 0) { n.click(); return true; }
        }
      }
      return false;
    }, COOKIE_TEXT_RX.source).catch(() => {});
  } catch {
    /* never let a banner-dismiss failure abort the capture */
  }
}

async function gotoSafe(page: any, url: string): Promise<void> {
  try {
    await page.goto(url, { waitUntil: 'networkidle2', timeout: 25_000 });
  } catch {
    // networkidle can time out on chatty sites — fall back to DOM-ready.
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
  }
}

async function capturePage(browser: any, url: string): Promise<PageCapture> {
  let page: any;
  try {
    page = await browser.newPage();
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    );

    // ── Desktop ───────────────────────────────────────────────────────────
    await page.setViewport(DESKTOP_VP);
    await gotoSafe(page, url);
    await dismissCookies(page);
    await sleep(500);

    const title = await page.title().catch(() => '');
    const heroText = await page
      .evaluate(() => (document.body?.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 1500))
      .catch(() => '');
    const desktop = (await page
      .screenshot({ type: 'jpeg', quality: 60, encoding: 'base64', fullPage: false })
      .catch(() => null)) as string | null;

    // ── Mobile (same page → consent already stored, banner stays gone) ──────
    await page.setViewport(MOBILE_VP);
    await page.reload({ waitUntil: 'domcontentloaded', timeout: 25_000 }).catch(() => {});
    await dismissCookies(page);
    await sleep(450);
    const mobile = (await page
      .screenshot({ type: 'jpeg', quality: 60, encoding: 'base64', fullPage: false })
      .catch(() => null)) as string | null;

    return { url, title, heroText, desktop, mobile };
  } catch (e) {
    return { url, title: '', heroText: '', desktop: null, mobile: null, error: e instanceof Error ? e.message : String(e) };
  } finally {
    await page?.close().catch(() => {});
  }
}

/** Run `worker` over `items` with at most `limit` in flight at once. */
async function mapLimit<T, R>(items: T[], limit: number, worker: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  async function run() {
    while (next < items.length) {
      const i = next++;
      out[i] = await worker(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, run));
  return out;
}

/**
 * Capture desktop + mobile above-the-fold for each URL. One browser launch,
 * reused across all pages so cookie consent persists site-wide. Bounded
 * concurrency keeps serverless memory/CPU in check.
 */
export async function capturePages(
  urls: string[],
  opts?: { concurrency?: number },
): Promise<PageCapture[]> {
  if (urls.length === 0) return [];
  const concurrency = opts?.concurrency ?? 3;

  let browser: any;
  try {
    browser = await launchBrowser();
  } catch (e) {
    // No Chromium available — surface as per-page errors so the audit still runs.
    return urls.map((url) => ({
      url, title: '', heroText: '', desktop: null, mobile: null,
      error: `browser unavailable: ${e instanceof Error ? e.message : String(e)}`,
    }));
  }

  try {
    return await mapLimit(urls, concurrency, (u) => capturePage(browser, u));
  } finally {
    await browser.close().catch(() => {});
  }
}
