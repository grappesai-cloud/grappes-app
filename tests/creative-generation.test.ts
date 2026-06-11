import { describe, it, expect, vi, afterEach } from 'vitest';
import { extractHtml, injectAnalytics, injectBacklink, injectFormHandler, applyBriefContent, injectStructuredData, findBrokenImages } from '../src/lib/creative-generation';

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
  it('injects grappes.dev badge', () => {
    const html = '<html><body><p>Content</p></body></html>';
    const result = injectBacklink(html);
    expect(result).toContain('grappes.dev');
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

describe('injectStructuredData', () => {
  const head = '<!DOCTYPE html><html><head><title>X</title></head><body>hi</body></html>';

  it('injects Organization JSON-LD from the brief', () => {
    const out = injectStructuredData(head, {
      business: { name: 'Acme', description: 'We do X', entity_type: 'organization' },
      contact: { email: 'a@b.com' },
      social: { instagram: 'https://instagram.com/acme' },
    });
    const m = out.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
    expect(m).toBeTruthy();
    const data = JSON.parse(m![1]);
    expect(data['@type']).toBe('Organization');
    expect(data.name).toBe('Acme');
    expect(data.email).toBe('a@b.com');
    expect(data.sameAs).toContain('https://instagram.com/acme');
  });

  it('uses Person type and jobTitle for personal brands', () => {
    const out = injectStructuredData(head, {
      business: { name: 'Jane', entity_type: 'person', tagline: 'DJ & Producer' },
    });
    const data = JSON.parse(out.match(/ld\+json">([\s\S]*?)<\/script>/)![1]);
    expect(data['@type']).toBe('Person');
    expect(data.jobTitle).toBe('DJ & Producer');
  });

  it('no-ops without a business name', () => {
    expect(injectStructuredData(head, {})).toBe(head);
  });

  it('does not double-inject', () => {
    const once = injectStructuredData(head, { business: { name: 'Acme' } });
    expect(injectStructuredData(once, { business: { name: 'Acme' } })).toBe(once);
  });
});

describe('findBrokenImages', () => {
  afterEach(() => vi.restoreAllMocks());

  it('flags only 4xx/5xx http(s) images, keeps relative and ok ones', async () => {
    const html = `
      <img src="https://ok.example/a.jpg">
      <img src="https://dead.example/b.jpg">
      <img src="/local/c.jpg">
    `;
    vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
      status: url.includes('dead') ? 404 : 200,
    })) as any);
    const broken = await findBrokenImages(html);
    expect(broken).toEqual(['https://dead.example/b.jpg']);
  });

  it('keeps images on network error (no false positives)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network'); }) as any);
    const broken = await findBrokenImages('<img src="https://x.example/a.jpg">');
    expect(broken).toEqual([]);
  });
});
