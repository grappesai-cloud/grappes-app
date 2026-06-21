// ── GET /api/brandbook/[id]/pdf — Puppeteer PDF export ────────────────────────
// The book is a single scrolling page, so we export it as ONE tall PDF page
// sized to the rendered content (no awkward A4 breaks across the dark sections).

import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { loadBrandBook, toDoc, renderBookHTML } from '../../../../lib/brandbook-db';
import { launchBrowser } from '../../../../lib/browser';

function slugify(s: string): string {
  return (s || 'brand')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'brand';
}

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  if (!checkRateLimit(`brandbook-pdf:${user.id}`, 5, 60_000)) {
    return json({ error: 'Slow down, try again in a moment.' }, 429);
  }

  const row = await loadBrandBook(params.id as string, user.id);
  const doc = row && toDoc(row);
  if (!doc) return json({ error: 'Brand book not found.' }, 404);

  const html = renderBookHTML(row, doc);

  let browser: any;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error('[brandbook/pdf] browser launch failed:', err);
    return json({ error: 'PDF engine unavailable.' }, 503);
  }
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 1000, deviceScaleFactor: 2 });
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 });
    // Google Fonts / @font-face can resolve after networkidle0 — wait for them.
    await page.evaluate(() => (document as any).fonts.ready);
    const height = await page.evaluate(() =>
      Math.ceil(document.documentElement.scrollHeight),
    );
    const pdf = await page.pdf({
      printBackground: true,
      width: '1280px',
      height: `${height}px`,
      pageRanges: '1',
    });

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="${slugify(doc.name)}-brand-guidelines.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[brandbook/pdf] generation failed:', err);
    return json({ error: 'Could not generate PDF.' }, 500);
  } finally {
    await browser.close();
  }
};
