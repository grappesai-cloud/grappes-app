// ── Headless browser launcher ─────────────────────────────────────────────────
// On Vercel serverless there is no bundled Chromium. The full `puppeteer`
// package would bloat the single Astro function past the 250 MB limit, so we use
// @sparticuz/chromium-min (no binary in the bundle) + puppeteer-core there, and
// fall back to full puppeteer locally (where a Chromium download exists).
//
// chromium-min downloads the matching brotli pack at runtime to /tmp (cached
// across warm invocations). The pack version MUST match the installed
// @sparticuz/chromium-min version (131.0.1).

const CHROMIUM_PACK =
  process.env.CHROMIUM_PACK_URL ||
  'https://github.com/Sparticuz/chromium/releases/download/v131.0.1/chromium-v131.0.1-pack.tar';

let cached: any = null;

export async function launchBrowser(): Promise<any> {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    const chromium = (await import('@sparticuz/chromium-min')).default;
    const puppeteer = (await import('puppeteer-core')).default;
    return puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(CHROMIUM_PACK),
      headless: true,
    });
  }

  // Local dev: prefer full puppeteer (ships its own Chromium).
  if (!cached) cached = (await import('puppeteer' as string)).default;
  return cached.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-dev-shm-usage'],
  });
}
