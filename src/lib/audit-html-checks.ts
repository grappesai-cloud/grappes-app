// ── HTML-based SEO checks ────────────────────────────────────────────────────
// Pure regex/string parsing (no extra deps). Each check returns a status:
//   ok    = passing, surface as green
//   warn  = present but suboptimal, surface as yellow
//   fail  = missing / broken, surface as red
// `fix` is a short, actionable instruction shown when the user expands the row.

export type CheckStatus = "ok" | "warn" | "fail";

export interface AuditCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail?: string;
  fix?: string;
}

export interface HtmlCheckResult {
  onpage: AuditCheck[];
  technical: AuditCheck[];
  /** Extracted main visible text so Claude can analyse content separately */
  mainText: string;
  /** Page title (for display) */
  title: string;
}

const HEAD_RX = /<head[^>]*>([\s\S]*?)<\/head>/i;
const TITLE_RX = /<title[^>]*>([\s\S]*?)<\/title>/i;
const META_RX = /<meta\b[^>]*>/gi;
const ATTR_RX = (name: string) =>
  new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, "i");

function getAttr(tag: string, name: string): string | null {
  const m = tag.match(ATTR_RX(name));
  return m ? m[1] : null;
}

function findMeta(html: string, predicate: (tag: string) => boolean): string | null {
  const head = html.match(HEAD_RX)?.[1] ?? html;
  const tags = head.match(META_RX) ?? [];
  for (const t of tags) if (predicate(t)) return t;
  return null;
}

function findMetaByName(html: string, name: string): string | null {
  return findMeta(html, (tag) => {
    const n = getAttr(tag, "name");
    return n !== null && n.toLowerCase() === name.toLowerCase();
  });
}

function findMetaByProperty(html: string, prop: string): string | null {
  return findMeta(html, (tag) => {
    const p = getAttr(tag, "property");
    return p !== null && p.toLowerCase() === prop.toLowerCase();
  });
}

function countTags(html: string, tag: string): number {
  const rx = new RegExp(`<${tag}\\b`, "gi");
  return (html.match(rx) ?? []).length;
}

function stripScriptStyle(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[\s\S]*?<\/style>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "");
}

function extractMainText(html: string): string {
  const cleaned = stripScriptStyle(html);
  // Prefer <main> if present, else body
  const main = cleaned.match(/<main\b[\s\S]*?<\/main>/i)?.[0]
    ?? cleaned.match(/<body\b[\s\S]*?<\/body>/i)?.[0]
    ?? cleaned;
  return main
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 8000); // cap for Claude prompt cost
}

export function runHtmlChecks(html: string, baseUrl: string): HtmlCheckResult {
  const onpage: AuditCheck[] = [];
  const technical: AuditCheck[] = [];

  // ─── Title ────────────────────────────────────────────────────────────
  const titleMatch = html.match(TITLE_RX);
  const titleText = titleMatch?.[1]?.trim() ?? "";
  if (!titleText) {
    onpage.push({ id: "title", label: "Page title", status: "fail",
      detail: "No <title> tag found.",
      fix: "Add a <title> tag in <head> with the page topic and brand (50-60 characters)." });
  } else if (titleText.length < 25) {
    onpage.push({ id: "title", label: "Page title", status: "warn",
      detail: `Title is ${titleText.length} chars: "${titleText}"`,
      fix: "Expand to 50-60 characters with descriptive keywords and brand name." });
  } else if (titleText.length > 65) {
    onpage.push({ id: "title", label: "Page title", status: "warn",
      detail: `Title is ${titleText.length} chars (will be truncated by Google).`,
      fix: "Trim to 50-60 characters; put the most important keyword first." });
  } else {
    onpage.push({ id: "title", label: "Page title", status: "ok",
      detail: `"${titleText}" (${titleText.length} chars)` });
  }

  // ─── Meta description ─────────────────────────────────────────────────
  const descTag = findMetaByName(html, "description");
  const descContent = descTag ? getAttr(descTag, "content") ?? "" : "";
  if (!descContent) {
    onpage.push({ id: "meta-desc", label: "Meta description", status: "fail",
      detail: "No <meta name=\"description\"> found.",
      fix: "Add a 150-160 character summary that includes the primary keyword." });
  } else if (descContent.length < 80) {
    onpage.push({ id: "meta-desc", label: "Meta description", status: "warn",
      detail: `Only ${descContent.length} chars.`,
      fix: "Expand to 150-160 characters; describe what the page offers + a CTA." });
  } else if (descContent.length > 170) {
    onpage.push({ id: "meta-desc", label: "Meta description", status: "warn",
      detail: `Description is ${descContent.length} chars (will be truncated).`,
      fix: "Trim to 150-160 characters." });
  } else {
    onpage.push({ id: "meta-desc", label: "Meta description", status: "ok",
      detail: `${descContent.length} chars` });
  }

  // ─── H1 count ─────────────────────────────────────────────────────────
  const h1Count = countTags(html, "h1");
  if (h1Count === 0) {
    onpage.push({ id: "h1", label: "H1 heading", status: "fail",
      detail: "No <h1> on the page.",
      fix: "Add exactly one <h1> with the main page topic." });
  } else if (h1Count > 1) {
    onpage.push({ id: "h1", label: "H1 heading", status: "warn",
      detail: `Found ${h1Count} <h1> tags.`,
      fix: "Keep one <h1> per page; demote the rest to <h2> or <h3>." });
  } else {
    onpage.push({ id: "h1", label: "H1 heading", status: "ok",
      detail: "Exactly one <h1> present." });
  }

  // ─── Heading hierarchy: any skipped levels? (h1 → h3 without h2) ─────
  const headingLevels = (html.match(/<h([1-6])\b/gi) ?? [])
    .map((t) => parseInt(t.match(/\d/)?.[0] ?? "0", 10))
    .filter((n) => n > 0);
  let skipped = false;
  for (let i = 1; i < headingLevels.length; i++) {
    if (headingLevels[i] > headingLevels[i - 1] + 1) {
      skipped = true;
      break;
    }
  }
  if (headingLevels.length === 0) {
    onpage.push({ id: "heading-hierarchy", label: "Heading hierarchy", status: "fail",
      detail: "No headings found at all.",
      fix: "Structure the page with semantic headings (h1 → h2 → h3)." });
  } else if (skipped) {
    onpage.push({ id: "heading-hierarchy", label: "Heading hierarchy", status: "warn",
      detail: "Heading levels skip (e.g. h1 → h3 without h2).",
      fix: "Use sequential heading levels; don't skip h2 between h1 and h3." });
  } else {
    onpage.push({ id: "heading-hierarchy", label: "Heading hierarchy", status: "ok" });
  }

  // ─── Images: alt attribute coverage ───────────────────────────────────
  const imgTags = html.match(/<img\b[^>]*>/gi) ?? [];
  const imgsWithoutAlt = imgTags.filter((t) => {
    const alt = getAttr(t, "alt");
    return alt === null; // missing entirely (empty alt="" is valid for decorative)
  });
  if (imgTags.length === 0) {
    onpage.push({ id: "img-alt", label: "Image alt text", status: "ok",
      detail: "No <img> tags on the page." });
  } else if (imgsWithoutAlt.length === 0) {
    onpage.push({ id: "img-alt", label: "Image alt text", status: "ok",
      detail: `All ${imgTags.length} images have alt attributes.` });
  } else {
    const pct = Math.round((imgsWithoutAlt.length / imgTags.length) * 100);
    onpage.push({ id: "img-alt", label: "Image alt text",
      status: pct > 30 ? "fail" : "warn",
      detail: `${imgsWithoutAlt.length} of ${imgTags.length} images missing alt (${pct}%).`,
      fix: "Add descriptive alt text to every image; use alt=\"\" only for purely decorative ones." });
  }

  // ─── Link text quality (no "click here") ──────────────────────────────
  const anchorTexts = Array.from(html.matchAll(/<a\b[^>]*>([\s\S]*?)<\/a>/gi))
    .map((m) => m[1].replace(/<[^>]+>/g, "").trim().toLowerCase())
    .filter((t) => t.length > 0);
  const genericLinks = anchorTexts.filter((t) =>
    /^(click here|here|read more|more|link|aici|click)$/i.test(t),
  );
  if (anchorTexts.length === 0) {
    onpage.push({ id: "link-text", label: "Link text quality", status: "warn",
      detail: "No anchor links found.",
      fix: "Add navigation and contextual links with descriptive anchor text." });
  } else if (genericLinks.length >= 3) {
    onpage.push({ id: "link-text", label: "Link text quality", status: "warn",
      detail: `${genericLinks.length} generic anchors (e.g. "click here").`,
      fix: "Replace generic anchor text with descriptive labels (e.g. \"View our pricing\")." });
  } else {
    onpage.push({ id: "link-text", label: "Link text quality", status: "ok" });
  }

  // ─── <html lang> attribute ────────────────────────────────────────────
  const htmlTag = html.match(/<html\b[^>]*>/i)?.[0] ?? "";
  const lang = getAttr(htmlTag, "lang");
  if (!lang) {
    onpage.push({ id: "lang", label: "Language attribute", status: "warn",
      detail: "Missing lang attribute on <html>.",
      fix: "Set <html lang=\"en\"> (or your site language) so screen readers and search engines know the language." });
  } else {
    onpage.push({ id: "lang", label: "Language attribute", status: "ok",
      detail: `lang="${lang}"` });
  }

  // ═══════════════════════════════════════════════════════════════════════
  // TECHNICAL SEO
  // ═══════════════════════════════════════════════════════════════════════

  // ─── Canonical URL ────────────────────────────────────────────────────
  const head = html.match(HEAD_RX)?.[1] ?? "";
  const canonicalTag = head.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)?.[0]
    ?? head.match(/<link\b[^>]*rel\s*=\s*canonical[^>]*>/i)?.[0];
  if (!canonicalTag) {
    technical.push({ id: "canonical", label: "Canonical URL", status: "warn",
      detail: "No <link rel=\"canonical\"> tag.",
      fix: "Add <link rel=\"canonical\" href=\"...\"> with the preferred URL of this page." });
  } else {
    technical.push({ id: "canonical", label: "Canonical URL", status: "ok",
      detail: getAttr(canonicalTag, "href") ?? "" });
  }

  // ─── Open Graph tags ──────────────────────────────────────────────────
  const ogTitle = findMetaByProperty(html, "og:title");
  const ogDesc = findMetaByProperty(html, "og:description");
  const ogImage = findMetaByProperty(html, "og:image");
  const ogCount = [ogTitle, ogDesc, ogImage].filter(Boolean).length;
  if (ogCount === 0) {
    technical.push({ id: "og", label: "Open Graph tags", status: "fail",
      detail: "No og:title, og:description, or og:image.",
      fix: "Add og:title, og:description, og:image so the site previews properly when shared." });
  } else if (ogCount < 3) {
    technical.push({ id: "og", label: "Open Graph tags", status: "warn",
      detail: `${ogCount}/3 OG tags present.`,
      fix: "Add the missing OG tag(s) for full social-sharing preview." });
  } else {
    technical.push({ id: "og", label: "Open Graph tags", status: "ok" });
  }

  // ─── Twitter Card ─────────────────────────────────────────────────────
  const twCard = findMetaByName(html, "twitter:card");
  if (!twCard) {
    technical.push({ id: "twitter", label: "Twitter card", status: "warn",
      detail: "No <meta name=\"twitter:card\">.",
      fix: "Add <meta name=\"twitter:card\" content=\"summary_large_image\"> plus twitter:title/description/image." });
  } else {
    technical.push({ id: "twitter", label: "Twitter card", status: "ok" });
  }

  // ─── Structured data (JSON-LD) ────────────────────────────────────────
  const jsonLd = html.match(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>/i);
  if (!jsonLd) {
    technical.push({ id: "schema", label: "Structured data (schema.org)", status: "warn",
      detail: "No JSON-LD structured data.",
      fix: "Add JSON-LD for at least Organization or WebSite type so Google can show rich results." });
  } else {
    technical.push({ id: "schema", label: "Structured data (schema.org)", status: "ok" });
  }

  // ─── Viewport meta ────────────────────────────────────────────────────
  const viewport = findMetaByName(html, "viewport");
  if (!viewport) {
    technical.push({ id: "viewport", label: "Viewport meta", status: "fail",
      detail: "No viewport meta tag.",
      fix: "Add <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">." });
  } else {
    technical.push({ id: "viewport", label: "Viewport meta", status: "ok" });
  }

  // ─── Favicon ──────────────────────────────────────────────────────────
  const favicon = head.match(/<link\b[^>]*rel\s*=\s*["'](?:icon|shortcut icon|apple-touch-icon)["'][^>]*>/i);
  if (!favicon) {
    technical.push({ id: "favicon", label: "Favicon", status: "warn",
      detail: "No favicon link tag.",
      fix: "Add <link rel=\"icon\" href=\"/favicon.ico\"> or similar." });
  } else {
    technical.push({ id: "favicon", label: "Favicon", status: "ok" });
  }

  // ─── HTTPS ────────────────────────────────────────────────────────────
  if (baseUrl.startsWith("https://")) {
    technical.push({ id: "https", label: "HTTPS", status: "ok" });
  } else {
    technical.push({ id: "https", label: "HTTPS", status: "fail",
      detail: "Page served over HTTP.",
      fix: "Enable HTTPS — Google ranks HTTPS pages higher and modern browsers flag HTTP as insecure." });
  }

  // ─── Charset ──────────────────────────────────────────────────────────
  const charset = head.match(/<meta\b[^>]*charset\s*=/i);
  if (!charset) {
    technical.push({ id: "charset", label: "Character encoding", status: "warn",
      detail: "No <meta charset> declaration.",
      fix: "Add <meta charset=\"UTF-8\"> as the first tag in <head>." });
  } else {
    technical.push({ id: "charset", label: "Character encoding", status: "ok" });
  }

  return {
    onpage,
    technical,
    mainText: extractMainText(html),
    title: titleText,
  };
}

// Score a list of checks: ok=2, warn=1, fail=0; normalized to 0-100.
export function scoreChecks(checks: AuditCheck[]): number {
  if (checks.length === 0) return 100;
  const sum = checks.reduce((acc, c) => acc + (c.status === "ok" ? 2 : c.status === "warn" ? 1 : 0), 0);
  return Math.round((sum / (checks.length * 2)) * 100);
}
