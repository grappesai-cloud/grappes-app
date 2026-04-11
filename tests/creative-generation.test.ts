import { describe, it, expect } from 'vitest';
import { extractHtml, injectAnalytics, injectBacklink, injectFormHandler, applyBriefContent } from '../src/lib/creative-generation';

describe('extractHtml', () => {
  it('extracts HTML from markdown fenced code block', () => {
    const raw = '```html\n<!DOCTYPE html><html><body>Hi</body></html>\n```';
    expect(extractHtml(raw)).toContain('<!DOCTYPE html>');
    expect(extractHtml(raw)).toContain('</html>');
  });

  it('extracts HTML from raw output', () => {
    const raw = 'Some preamble\n<!DOCTYPE html><html><body>Hi</body></html>';
    expect(extractHtml(raw)).toContain('<!DOCTYPE html>');
  });

  it('returns input unchanged when no HTML markers found', () => {
    const result = extractHtml('just some text');
    // extractHtml returns the input if no <!DOCTYPE or </html> found
    expect(result).not.toContain('<!DOCTYPE');
  });
});

describe('injectAnalytics', () => {
  const html = '<!DOCTYPE html><html><head><title>T</title></head><body></body></html>';

  it('injects self-hosted beacon when no GA ID', () => {
    const result = injectAnalytics(html, {}, 'proj-123');
    expect(result).toContain('__grappes_track');
    expect(result).toContain('proj-123');
  });

  it('injects GA4 when ga_id provided', () => {
    const result = injectAnalytics(html, { analytics: { ga_id: 'G-TESTID123' } }, 'proj-123');
    expect(result).toContain('gtag');
    expect(result).toContain('G-TESTID123');
  });

  it('does not double-inject', () => {
    const withBeacon = injectAnalytics(html, {}, 'proj-123');
    const doubled = injectAnalytics(withBeacon, {}, 'proj-123');
    expect(doubled).toBe(withBeacon);
  });
});

describe('injectBacklink', () => {
  it('injects grappes.ai badge', () => {
    const html = '<html><body><p>Content</p></body></html>';
    const result = injectBacklink(html);
    expect(result).toContain('grappes.ai');
  });

  it('normalizes copyright year', () => {
    const html = '<html><body>© 2023 Company</body></html>';
    const result = injectBacklink(html);
    const currentYear = new Date().getFullYear().toString();
    expect(result).toContain(`© ${currentYear}`);
  });
});

describe('injectFormHandler', () => {
  it('injects form handler when forms present', () => {
    const html = '<html><body><form><input type="text" /></form></body></html>';
    const result = injectFormHandler(html, 'proj-123');
    expect(result).toContain('grappes form handler');
    expect(result).toContain('proj-123');
  });

  it('does nothing when no forms', () => {
    const html = '<html><body><p>No forms</p></body></html>';
    const result = injectFormHandler(html, 'proj-123');
    expect(result).toBe(html);
  });
});

describe('applyBriefContent', () => {
  it('corrects H1 to brief headline', () => {
    const html = '<html><body><h1>AI Generated Title</h1></body></html>';
    const brief = { content: { headline: 'My Real Title' } };
    const result = applyBriefContent(html, brief);
    expect(result.html).toContain('My Real Title');
  });

  it('does not replace H1 with inner HTML tags', () => {
    const html = '<html><body><h1><span class="styled">Title</span></h1></body></html>';
    const brief = { content: { headline: 'New Title' } };
    const result = applyBriefContent(html, brief);
    // Should skip H1s with inner markup
    expect(result.html).toContain('<span class="styled">');
  });
});
