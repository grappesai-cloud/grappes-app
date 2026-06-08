// ── Offer → PDF ───────────────────────────────────────────────────────────────
// POST an Offer JSON, get back an A4 PDF rendered from the Grappes offer template.
// Uses the same Puppeteer setup as visual-qa (bundled Chromium, --no-sandbox).

import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-utils';
import { checkRateLimit } from '../../../lib/rate-limit';
import { renderOfferHTML, type Offer } from '../../../lib/offer-template';
import { launchBrowser } from '../../../lib/browser';

function slugify(s: string): string {
  return (s || 'oferta')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'oferta';
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to generate an offer.' }, 401);

  if (!checkRateLimit(`offer-pdf:${user.id}`, 10, 60_000)) {
    return json({ error: 'Slow down, try again in a moment.' }, 429);
  }

  let offer: Offer;
  try {
    offer = (await request.json()) as Offer;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  if (!offer?.client || !Array.isArray(offer.services)) {
    return json({ error: 'Offer needs a client and at least one service.' }, 400);
  }

  const html = renderOfferHTML(offer);

  let browser: any;
  try {
    browser = await launchBrowser();
  } catch (err) {
    console.error('[offers/pdf] browser launch failed:', err);
    return json({ error: 'PDF engine unavailable.' }, 503);
  }
  try {
    const page = await browser.newPage();
    await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
    const pdf = await page.pdf({
      format: 'A4',
      printBackground: true,
      preferCSSPageSize: true,
    });

    return new Response(pdf, {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="oferta-${slugify(offer.client)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    console.error('[offers/pdf] generation failed:', err);
    return json({ error: 'Could not generate PDF.' }, 500);
  } finally {
    await browser.close();
  }
};
