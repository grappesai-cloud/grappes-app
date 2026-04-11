#!/usr/bin/env node
/**
 * Puppeteer smoke test: screenshot the public routes and dump dimensions,
 * so we can catch layout regressions after the rebrand.
 *
 * Usage:  node scripts/smoke-screens.mjs [http://localhost:4321]
 */
import puppeteer from 'puppeteer';
import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';

const BASE = process.argv[2] || 'http://localhost:4321';
const OUT = resolve('./dist-screenshots');
mkdirSync(OUT, { recursive: true });

const ROUTES = [
  { path: '/',               wait: 2000 },
  { path: '/sign-in',        wait: 1200 },
  { path: '/sign-up',        wait: 1200 },
  { path: '/forgot-password',wait: 1000 },
  { path: '/terms',          wait: 800  },
  { path: '/privacy',        wait: 800  },
];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox'] });
console.log(`\n🎬 Smoke screens for ${BASE}\n`);

for (const { path, wait } of ROUTES) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 2 });
  const url = BASE + path;
  const errors = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console.error: ${msg.text().slice(0, 120)}`);
  });
  page.on('requestfailed', (req) => {
    if (!req.url().includes('fonts.gstatic')) {
      errors.push(`reqfail: ${req.url().slice(0, 80)} (${req.failure()?.errorText})`);
    }
  });

  try {
    const resp = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await new Promise(r => setTimeout(r, wait));
    const title = await page.title();
    const bodyHeight = await page.evaluate(() => document.body.scrollHeight);
    const filename = path === '/' ? 'index.png' : `${path.replace(/\//g, '_').replace(/^_/, '')}.png`;
    const out = resolve(OUT, filename);
    await page.screenshot({ path: out, fullPage: false });
    const status = resp?.status() || 0;
    const badge = status === 200 ? '✓' : '✗';
    console.log(`  ${badge} ${status}  ${path.padEnd(22)}  "${title.slice(0, 60)}"  h=${bodyHeight}px  → ${filename}`);
    if (errors.length) {
      console.log(`    ⚠ ${errors.slice(0, 3).join(' | ')}`);
    }
  } catch (err) {
    console.log(`  ✗ ERR  ${path.padEnd(22)}  ${err.message.slice(0, 80)}`);
  }
  await page.close();
}

await browser.close();
console.log(`\nScreenshots saved to ${OUT}\n`);
