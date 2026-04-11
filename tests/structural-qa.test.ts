import { describe, it, expect } from 'vitest';
import { runStructuralQA } from '../src/lib/structural-qa';

describe('runStructuralQA', () => {
  const validHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Test Site — Great Title</title>
  <meta name="description" content="This is a test site with a description that is long enough to pass the minimum character requirement for meta descriptions." />
  <meta property="og:title" content="Test Site" />
  <meta property="og:description" content="OG description here" />
</head>
<body>
  <h1>Welcome to Test Site</h1>
  <img src="hero.jpg" alt="Hero image" />
</body>
</html>`;

  it('passes all checks for valid HTML', () => {
    const result = runStructuralQA(validHtml);
    expect(result.passed).toBe(true);
    expect(result.score).toBe(100);
  });

  it('fails on missing DOCTYPE', () => {
    const html = '<html><head><title>X</title></head><body></body></html>';
    const result = runStructuralQA(html);
    const doctype = result.checks.find(c => c.name === 'DOCTYPE');
    expect(doctype?.passed).toBe(false);
  });

  it('fails on missing H1', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Test Title Here</title><meta name="description" content="' + 'x'.repeat(60) + '"><meta property="og:title" content="T"><meta property="og:description" content="D"></head><body><h2>No H1</h2></body></html>';
    const result = runStructuralQA(html);
    const h1 = result.checks.find(c => c.name === 'Single H1');
    expect(h1?.passed).toBe(false);
  });

  it('fails on missing alt text', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Test Title Here</title><meta name="description" content="' + 'x'.repeat(60) + '"><meta property="og:title" content="T"><meta property="og:description" content="D"></head><body><h1>Hi</h1><img src="x.jpg" /></body></html>';
    const result = runStructuralQA(html);
    const alt = result.checks.find(c => c.name.includes('alt'));
    expect(alt?.passed).toBe(false);
  });

  it('fails on multiple H1s', () => {
    const html = '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width"><title>Test Title Here</title><meta name="description" content="' + 'x'.repeat(60) + '"><meta property="og:title" content="T"><meta property="og:description" content="D"></head><body><h1>First</h1><h1>Second</h1></body></html>';
    const result = runStructuralQA(html);
    const h1 = result.checks.find(c => c.name === 'Single H1');
    expect(h1?.passed).toBe(false);
  });
});
