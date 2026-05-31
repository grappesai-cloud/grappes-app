// Generate the test offer PDF for adelina.delia.dragos using the live template.
// Run: npx tsx scripts/gen-test-offer.mts
import puppeteer from 'puppeteer';
import { writeFileSync } from 'node:fs';
import { renderOfferHTML, SAMPLE_OFFER } from '../src/lib/offer-template.ts';

const html = renderOfferHTML(SAMPLE_OFFER);
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const page = await browser.newPage();
await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
const out = '/Users/alexandrucojanu/Desktop/Oferta-Adelina-Delia-Dragos.pdf';
await page.pdf({ path: out, format: 'A4', printBackground: true, preferCSSPageSize: true });
await browser.close();
console.log('Wrote ' + out);
