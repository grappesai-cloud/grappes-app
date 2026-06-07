// ── Fetch a brand's public website and distill it into prompt context ─────────
// Used by Brand Book Lab generation when the user provides their site. Best
// effort: any failure returns null and generation proceeds without it.

export interface WebsiteContext {
  url: string;
  title: string;
  description: string;
  text: string; // visible copy, whitespace-collapsed, capped
}

const PRIVATE_HOST_RE = /^(localhost|127\.|0\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$|.*\.local)$/i;

function normalizeUrl(raw: string): URL | null {
  let s = (raw || '').trim();
  if (!s) return null;
  if (!/^https?:\/\//i.test(s)) s = `https://${s}`;
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return null;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
  // SSRF guard: no localhost/private/raw-IP targets.
  if (PRIVATE_HOST_RE.test(u.hostname) || /^\d+\.\d+\.\d+\.\d+$/.test(u.hostname)) return null;
  if (!u.hostname.includes('.')) return null;
  return u;
}

function stripHtml(html: string): { title: string; description: string; text: string } {
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '';
  const description =
    html.match(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i)?.[1] ??
    html.match(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i)?.[1] ?? '';
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<svg[\s\S]*?<\/svg>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&[a-z#0-9]+;/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return { title, description, text };
}

export async function fetchWebsiteContext(rawUrl: string): Promise<WebsiteContext | null> {
  const url = normalizeUrl(rawUrl);
  if (!url) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(url.toString(), {
      signal: ctrl.signal,
      redirect: 'follow',
      headers: {
        'user-agent': 'Mozilla/5.0 (compatible; GrappesBrandBook/1.0; +https://grappes.dev)',
        accept: 'text/html,application/xhtml+xml',
      },
    });
    if (!res.ok) return null;
    const type = res.headers.get('content-type') || '';
    if (!type.includes('html')) return null;
    // Cap the body at ~600KB so a huge page can't blow up memory.
    const raw = (await res.text()).slice(0, 600_000);
    const { title, description, text } = stripHtml(raw);
    if (!text && !description) return null;
    return { url: url.toString(), title: title.slice(0, 200), description: description.slice(0, 400), text: text.slice(0, 2800) };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
