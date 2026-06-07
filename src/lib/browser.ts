// ── Headless browser launcher ─────────────────────────────────────────────────
// On Vercel serverless there is no bundled Chromium, so the full `puppeteer`
// package's launch() fails ("Could not find Chromium"). We use
// @sparticuz/chromium + puppeteer-core there, and fall back to full puppeteer
// locally (where a Chromium download exists).

let cached: any = null;

export async function launchBrowser(): Promise<any> {
  const isServerless = !!process.env.VERCEL || !!process.env.AWS_LAMBDA_FUNCTION_NAME;

  if (isServerless) {
    // Normal (non-cast) imports so Vercel's file tracer bundles these into the
    // serverless function — the chromium binary ships inside @sparticuz/chromium.
    const chromium = (await import('@sparticuz/chromium')).default;
    const puppeteer = (await import('puppeteer-core')).default;
    return puppeteer.launch({
      args: [...chromium.args, '--no-sandbox', '--disable-dev-shm-usage'],
      defaultViewport: { width: 1280, height: 720 },
      executablePath: await chromium.executablePath(),
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
