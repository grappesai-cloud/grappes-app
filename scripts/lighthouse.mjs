#!/usr/bin/env node
/**
 * Lighthouse audit runner for generated HTML files.
 *
 * Usage:
 *   node scripts/lighthouse.mjs <html-file-or-directory> [--json] [--out <report.json>]
 *
 * Examples:
 *   node scripts/lighthouse.mjs /tmp/site/index.html
 *   node scripts/lighthouse.mjs /tmp/site/ --json --out /tmp/lh-report.json
 *
 * Requirements (install once):
 *   npm install --save-dev lighthouse puppeteer http-server
 *   or: npm install -g lighthouse
 */

import { createServer } from 'http';
import { readFileSync, readdirSync, statSync, writeFileSync } from 'fs';
import { extname, resolve, basename } from 'path';
import { fileURLToPath } from 'url';

// ── Parse CLI args ─────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const targetArg = args.find(a => !a.startsWith('--'));
const jsonMode = args.includes('--json');
const outIndex = args.indexOf('--out');
const outFile = outIndex !== -1 ? args[outIndex + 1] : null;

if (!targetArg) {
  console.error('Usage: node scripts/lighthouse.mjs <html-file-or-directory> [--json] [--out report.json]');
  process.exit(1);
}

// ── Collect HTML files ─────────────────────────────────────────────────────────
const target = resolve(targetArg);
let htmlFiles = [];

try {
  const stat = statSync(target);
  if (stat.isDirectory()) {
    htmlFiles = readdirSync(target)
      .filter(f => f.endsWith('.html'))
      .map(f => ({ name: f, path: resolve(target, f) }));
  } else {
    htmlFiles = [{ name: basename(target), path: target }];
  }
} catch (e) {
  console.error(`Cannot read target: ${target}`);
  process.exit(1);
}

if (htmlFiles.length === 0) {
  console.error('No HTML files found.');
  process.exit(1);
}

// ── Import Lighthouse (must be installed) ─────────────────────────────────────
let lighthouse, chromeLauncher;
try {
  const lhModule = await import('lighthouse');
  lighthouse = lhModule.default ?? lhModule.lighthouse ?? lhModule;
  chromeLauncher = await import('chrome-launcher');
} catch {
  console.error(
    'Lighthouse not found. Install it:\n  npm install --save-dev lighthouse chrome-launcher'
  );
  process.exit(1);
}

// ── Serve HTML files locally ───────────────────────────────────────────────────
const PORT = 9876;
const fileMap = Object.fromEntries(htmlFiles.map(f => [f.name, f.path]));

const server = createServer((req, res) => {
  const name = req.url === '/' ? htmlFiles[0].name : req.url.slice(1);
  const filePath = fileMap[name];
  if (!filePath) {
    res.writeHead(404);
    res.end('Not found');
    return;
  }
  try {
    const content = readFileSync(filePath);
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(content);
  } catch {
    res.writeHead(500);
    res.end('Error reading file');
  }
});

await new Promise(resolve => server.listen(PORT, resolve));
console.log(`\nServing ${htmlFiles.length} file(s) on http://localhost:${PORT}\n`);

// ── Run Lighthouse for each file ───────────────────────────────────────────────
const CATEGORIES = ['performance', 'accessibility', 'best-practices', 'seo'];
const results = [];

const chrome = await chromeLauncher.launch({ chromeFlags: ['--headless', '--no-sandbox'] });

for (const file of htmlFiles) {
  const url = `http://localhost:${PORT}/${file.name}`;
  console.log(`Auditing ${file.name}…`);

  try {
    const runnerResult = await lighthouse(url, {
      port: chrome.port,
      output: 'json',
      logLevel: 'error',
      onlyCategories: CATEGORIES,
    });

    const lhr = runnerResult.lhr;
    const scores = Object.fromEntries(
      CATEGORIES.map(cat => [
        cat,
        Math.round((lhr.categories[cat]?.score ?? 0) * 100),
      ])
    );

    const passed = Object.values(scores).every(s => s >= 80);

    results.push({
      page: file.name,
      url,
      scores,
      passed,
      fetchTime: lhr.fetchTime,
    });

    if (!jsonMode) {
      const line = CATEGORIES.map(c => `${c}: ${scores[c]}`).join('  |  ');
      const status = passed ? '✓ PASS' : '✗ FAIL';
      console.log(`  ${status}  ${line}`);
    }
  } catch (e) {
    console.error(`  Error auditing ${file.name}: ${e.message}`);
    results.push({ page: file.name, url, error: e.message });
  }
}

await chrome.kill();
server.close();

// ── Output ─────────────────────────────────────────────────────────────────────
const summary = {
  auditedAt: new Date().toISOString(),
  pages: results,
  overallPassed: results.every(r => r.passed),
  avgScores: (() => {
    const valid = results.filter(r => r.scores);
    if (valid.length === 0) return {};
    return Object.fromEntries(
      CATEGORIES.map(cat => [
        cat,
        Math.round(valid.reduce((sum, r) => sum + (r.scores[cat] ?? 0), 0) / valid.length),
      ])
    );
  })(),
};

if (jsonMode || outFile) {
  const json = JSON.stringify(summary, null, 2);
  if (outFile) {
    writeFileSync(outFile, json);
    console.log(`\nReport written to ${outFile}`);
  } else {
    console.log(json);
  }
} else {
  const avgLine = CATEGORIES.map(c => `${c}: ${summary.avgScores[c] ?? '—'}`).join('  |  ');
  console.log(`\n── AVERAGE ──  ${avgLine}`);
  console.log(`Overall: ${summary.overallPassed ? '✓ ALL PASS' : '✗ SOME PAGES NEED WORK'}`);
}

process.exit(summary.overallPassed ? 0 : 1);
