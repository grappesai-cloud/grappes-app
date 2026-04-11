import { describe, it, expect } from 'vitest';
import { autoFix } from '../src/lib/auto-fix';

describe('autoFix', () => {
  it('adds onsubmit to forms without action', () => {
    const html = '<html><body><form><input type="text" /></form></body></html>';
    const result = autoFix(html, 'test-project');
    expect(result.html).toContain('event.preventDefault()');
  });

  it('adds loading=lazy to images after the first two', () => {
    const html = `<html><body>
      <img src="a.jpg" alt="first" />
      <img src="b.jpg" alt="second" />
      <img src="c.jpg" alt="third" />
      <img src="d.jpg" alt="fourth" />
    </body></html>`;
    const result = autoFix(html, 'test-project');
    // First two should NOT have lazy
    const matches = result.html.match(/loading="lazy"/g) || [];
    expect(matches.length).toBe(2); // 3rd and 4th images
  });

  it('deduplicates section markers', () => {
    const html = `<html><body>
      <!-- SECTION:hero -->
      <section data-section="hero">First hero</section>
      <!-- /SECTION:hero -->
      <!-- SECTION:hero -->
      <section data-section="hero">Duplicate hero</section>
      <!-- /SECTION:hero -->
    </body></html>`;
    const result = autoFix(html, 'test-project');
    expect(result.html).toContain('SECTION:hero-2');
  });
});
