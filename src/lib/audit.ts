// ── SEO + performance audit orchestrator ─────────────────────────────────────
// Combines three signals into one report:
//   1. PageSpeed Insights (Google API) — performance + accessibility scores
//   2. HTML parsing (lib/audit-html-checks) — on-page + technical SEO
//   3. Claude Haiku — content/keyword analysis from the page's main text
//
// Each step is wrapped in try/catch so a failure in one doesn't kill the whole
// audit; the report shows what we could analyse and reports the rest as errors.

import { put } from '@lib/r2-blob';
import { createMessage, HAIKU_MODEL } from "./anthropic";
import {
  runHtmlChecks,
  scoreChecks,
  type AuditCheck,
} from "./audit-html-checks";
import { capturePages, type PageCapture } from "./audit-capture";

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

/** What the visitor is meant to do — shapes the Attention + Content analysis. */
export type AuditGoal = "sales" | "presentation";

/** Hard cap on how many pages we crawl + screenshot per audit (cost/time). */
const MAX_AUDIT_PAGES = 30;

export interface PerfReport {
  score: number; // 0-100
  metrics: {
    LCP: { value: number; unit: string; score: number };
    CLS: { value: number; unit: string; score: number };
    INP: { value: number; unit: string; score: number } | null;
    FCP: { value: number; unit: string; score: number };
    TBT: { value: number; unit: string; score: number };
    SI:  { value: number; unit: string; score: number };
  };
  /** Top 5 opportunities surfaced by Lighthouse */
  opportunities: { id: string; title: string; description: string; savingsMs?: number }[];
  /** Lighthouse accessibility score (separate axis, surfaced alongside perf) */
  accessibilityScore: number;
  bestPracticesScore: number;
  /** Lighthouse's own SEO score — we DO surface this, but our HTML checks are more granular */
  lhSeoScore: number;
  /** Mobile viewport screenshot (data URI) from Lighthouse — reused for the Attention lens */
  screenshot?: string;
}

/**
 * SimClusters-inspired view: a site that sits clearly in ONE topical
 * community ranks better than one that's smeared across many. We classify
 * the visible body text into canonical web niches with confidence per
 * niche, then derive how concentrated that distribution is.
 *
 * coherenceScore = round(100 * (top - mean(rest))) — high gap = clear
 * positioning; flat distribution = ambiguous (the X heavy-ranker would
 * struggle to find a community to amplify into).
 */
export interface NicheCoherence {
  primary: { id: string; label: string; confidence: number };
  secondary: { id: string; label: string; confidence: number }[];
  coherenceScore: number; // 0-100
  ambiguity: "low" | "medium" | "high";
  positioning: string; // one-sentence verdict
  recommendation: string; // one-sentence concrete fix
}

export interface ContentReport {
  score: number;
  summary: string;
  primaryTopic: string;
  primaryKeywords: string[];
  /** Issues like thin content, keyword stuffing, unclear topic */
  issues: AuditCheck[];
  /** Specific suggestions */
  suggestions: string[];
  /** SimClusters-style niche-fit lens; optional so legacy reports still render */
  nicheCoherence?: NicheCoherence;
}

/**
 * First-impression / attention lens — judges the above-the-fold screenshot the
 * way a human (or the X heavy-ranker's dwell signal) reacts in the first ~3s:
 * does it grab attention, is the value-prop clear, does the eye reach the CTA.
 * Distinct from SEO/perf, so surfaced as its own score (not folded into overall).
 */
/** One viewport's first-impression verdict (desktop or mobile). */
export interface ViewportAttention {
  score: number; // 0-100
  verdict: string;
  checks: AuditCheck[];
  screenshot?: string; // public Blob URL of the above-the-fold shot
}

export interface PageAttention {
  url: string;
  score: number; // 0-100 — average of the available viewports
  verdict: string; // kept for backward compat (mobile, or whichever exists)
  checks: AuditCheck[]; // kept for backward compat
  screenshot?: string; // kept for backward compat (mobile URL)
  /** Per-viewport breakdown — the page is judged on BOTH desktop and mobile. */
  desktop?: ViewportAttention;
  mobile?: ViewportAttention;
}

export interface AttentionReport {
  /** Primary (submitted) page — kept top-level for backward compat. */
  score: number; // 0-100
  verdict: string;
  checks: AuditCheck[];
  /** Per-page breakdown when a multi-page crawl ran (includes the primary page). */
  pages?: PageAttention[];
  /** Site-level average across crawled pages. */
  siteScore?: number;
  /** Conversion goal the analysis was tuned for. */
  goal?: AuditGoal;
  /** How many pages were crawled and whether the site had more than the cap. */
  pagesCrawled?: number;
  pagesTruncated?: boolean;
}

export interface AuditReport {
  url: string;
  fetchedAt: string;
  /** Conversion goal chosen before the run (sales vs presentation). */
  goal?: AuditGoal;
  perf?: PerfReport;
  onpage: AuditCheck[];
  technical: AuditCheck[];
  content?: ContentReport;
  attention?: AttentionReport;
  /** Errors per category if a sub-pipeline failed */
  errors: Record<string, string>;
  scores: {
    overall: number;
    perf: number;
    onpage: number;
    technical: number;
    content: number;
    attention?: number;
  };
}

// ── PageSpeed Insights ──────────────────────────────────────────────────────
async function runPSI(url: string): Promise<PerfReport> {
  const apiKey = import.meta.env.PSI_API_KEY ?? process.env.PSI_API_KEY;
  if (!apiKey) throw new Error("PSI_API_KEY not configured");

  const params = new URLSearchParams({
    url,
    strategy: "mobile",
    key: apiKey,
  });
  for (const cat of ["performance", "accessibility", "best-practices", "seo"]) {
    params.append("category", cat);
  }

  const r = await fetch(`${PSI_ENDPOINT}?${params}`);
  if (!r.ok) {
    const body = await r.text().catch(() => "");
    throw new Error(`PSI ${r.status}: ${body.slice(0, 200)}`);
  }
  const data = (await r.json()) as any;

  const lh = data.lighthouseResult;
  const audits = lh?.audits ?? {};
  const cats = lh?.categories ?? {};

  // Top 5 perf opportunities by savings_ms desc
  const opportunities = Object.values(audits)
    .filter((a: any) => a.details?.type === "opportunity" && a.score !== null && a.score < 0.9)
    .map((a: any) => ({
      id: a.id,
      title: a.title,
      description: (a.description as string)?.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1").slice(0, 220),
      savingsMs: a.details?.overallSavingsMs ?? undefined,
    }))
    .sort((a: any, b: any) => (b.savingsMs ?? 0) - (a.savingsMs ?? 0))
    .slice(0, 5);

  function metric(id: string) {
    const a = audits[id];
    return {
      value: a?.numericValue ?? 0,
      unit: a?.numericUnit ?? "ms",
      score: Math.round((a?.score ?? 0) * 100),
    };
  }

  return {
    score: Math.round((cats.performance?.score ?? 0) * 100),
    metrics: {
      LCP: metric("largest-contentful-paint"),
      CLS: metric("cumulative-layout-shift"),
      INP: audits["interaction-to-next-paint"] ? metric("interaction-to-next-paint") : null,
      FCP: metric("first-contentful-paint"),
      TBT: metric("total-blocking-time"),
      SI:  metric("speed-index"),
    },
    opportunities,
    accessibilityScore: Math.round((cats.accessibility?.score ?? 0) * 100),
    bestPracticesScore: Math.round((cats["best-practices"]?.score ?? 0) * 100),
    lhSeoScore: Math.round((cats.seo?.score ?? 0) * 100),
    screenshot:
      (audits["final-screenshot"]?.details?.data as string | undefined) ??
      undefined,
  };
}

// ── Robots.txt / sitemap.xml technical checks ───────────────────────────────
async function checkRobotsAndSitemap(baseUrl: string): Promise<AuditCheck[]> {
  const out: AuditCheck[] = [];
  const origin = new URL(baseUrl).origin;

  // robots.txt
  try {
    const r = await fetch(`${origin}/robots.txt`, { redirect: "follow" });
    if (!r.ok) {
      out.push({ id: "robots", label: "robots.txt", status: "warn",
        detail: `Returns ${r.status}.`,
        fix: "Add a /robots.txt file even if it's just `User-agent: *\\nAllow: /`." });
    } else {
      const body = await r.text();
      if (/Disallow:\s*\/\s*$/im.test(body) && !/Allow:\s*\//im.test(body)) {
        out.push({ id: "robots", label: "robots.txt", status: "fail",
          detail: "robots.txt blocks the entire site (Disallow: /).",
          fix: "Remove the blanket Disallow rule unless you really want the site de-indexed." });
      } else {
        out.push({ id: "robots", label: "robots.txt", status: "ok" });
      }
    }
  } catch {
    out.push({ id: "robots", label: "robots.txt", status: "warn",
      detail: "Could not reach /robots.txt.",
      fix: "Add a /robots.txt file at the site root." });
  }

  // sitemap.xml
  try {
    const r = await fetch(`${origin}/sitemap.xml`, { redirect: "follow" });
    if (!r.ok) {
      out.push({ id: "sitemap", label: "sitemap.xml", status: "warn",
        detail: `Returns ${r.status}.`,
        fix: "Generate a sitemap.xml and submit it to Google Search Console." });
    } else {
      out.push({ id: "sitemap", label: "sitemap.xml", status: "ok" });
    }
  } catch {
    out.push({ id: "sitemap", label: "sitemap.xml", status: "warn",
      detail: "Could not reach /sitemap.xml.",
      fix: "Generate and host a sitemap.xml at the site root." });
  }

  return out;
}

// ── Claude content analysis ─────────────────────────────────────────────────
const GOAL_CONTENT_LENS: Record<AuditGoal, string> = {
  sales:
    "The site's goal is SALES / CONVERSION. Weight the analysis toward: a clear value proposition, benefit-led (not feature-list) copy, urgency/proof (testimonials, numbers, guarantees), and whether the copy pushes the reader toward a purchase or sign-up. Flag vague or purely descriptive copy that doesn't sell.",
  presentation:
    "The site's goal is PRESENTATION / BRAND. Weight the analysis toward: clarity of who this is and what they stand for, tone and brand consistency, memorability, and whether the copy tells a coherent story. Flag generic copy that could belong to any brand.",
};

async function runContentAnalysis(params: {
  url: string;
  title: string;
  mainText: string;
  goal: AuditGoal;
}): Promise<ContentReport> {
  if (params.mainText.length < 200) {
    return {
      score: 30,
      summary: "Page has very little visible text.",
      primaryTopic: "unclear",
      primaryKeywords: [],
      issues: [{
        id: "thin-content",
        label: "Thin content",
        status: "fail",
        detail: `Only ${params.mainText.length} characters of visible body text.`,
        fix: "Add at least 300-500 words of meaningful content describing what the page offers.",
      }],
      suggestions: ["Add a clear hero paragraph and at least one descriptive section."],
    };
  }

  const system = `You are an SEO content analyst. Given the main visible text of a web page, return ONLY a JSON object with these fields and nothing else:
{
  "primaryTopic": "1-3 word topic of the page",
  "primaryKeywords": ["up to 5 keywords this page is targeting"],
  "wordCount": number,
  "readabilityNote": "one short sentence",
  "issues": [
    { "id": "kebab-id", "label": "short label", "status": "ok"|"warn"|"fail",
      "detail": "one sentence", "fix": "one-sentence concrete fix" }
  ],
  "suggestions": ["up to 3 concrete improvements"],
  "score": 0-100,
  "nicheFit": [
    { "id": "kebab-id", "label": "Human-readable", "confidence": 0-100 }
  ]
}

For "nicheFit": pick the 3 niches this page best fits, ordered by confidence desc, from this canonical list:
saas-product, dev-tool, ai-tool, ecommerce-store, marketplace, fashion-apparel, food-restaurant, food-recipe, food-supplier-b2b, fitness-gym, fitness-coach, health-wellness, beauty-cosmetics, beauty-salon, travel-hotel, travel-agency, real-estate, automotive-dealer, automotive-service, finance-fintech, legal-services, education-course, education-school, agency-creative, agency-marketing, agency-dev, freelancer-portfolio, artist-musician, artist-visual, photographer, news-media, blog-personal, community-forum, nonprofit, b2b-services, b2b-manufacturing, local-business, event-conference, healthcare-clinic, gaming, podcast.

If the page truly doesn't fit any, return ONE entry with id "other" confidence 50. Confidence must sum to a value that reflects actual belief; if the site is clearly one niche, top should be ≥70 and the rest ≤30.

Also check for: clear primary topic, keyword stuffing, thin content, missing structured sections (no clear intro/value-prop), readability, generic copy that could fit any business, mismatch between title and body.

${GOAL_CONTENT_LENS[params.goal]}`;

  const user = `URL: ${params.url}
Page title: ${params.title}

Main visible text:
"""
${params.mainText}
"""

Return the JSON object now.`;

  const r = await createMessage({
    model: HAIKU_MODEL,
    max_tokens: 1200,
    system,
    messages: [{ role: "user", content: user }],
  });
  const text = r.content[0]?.type === "text" ? r.content[0].text : "{}";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();

  let parsed: any = {};
  try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

  return {
    score: typeof parsed.score === "number" ? parsed.score : 50,
    summary: parsed.readabilityNote ?? "",
    primaryTopic: parsed.primaryTopic ?? "unclear",
    primaryKeywords: Array.isArray(parsed.primaryKeywords) ? parsed.primaryKeywords.slice(0, 5) : [],
    issues: Array.isArray(parsed.issues) ? parsed.issues.slice(0, 6) : [],
    suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions.slice(0, 3) : [],
    nicheCoherence: deriveNicheCoherence(parsed.nicheFit),
  };
}

function deriveNicheCoherence(raw: unknown): NicheCoherence | undefined {
  if (!Array.isArray(raw) || raw.length === 0) return undefined;
  const cleaned = raw
    .filter(
      (n): n is { id: string; label: string; confidence: number } =>
        n != null &&
        typeof n.id === "string" &&
        typeof n.label === "string" &&
        typeof n.confidence === "number",
    )
    .map((n) => ({
      id: n.id,
      label: n.label,
      confidence: Math.max(0, Math.min(100, Math.round(n.confidence))),
    }))
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, 3);

  if (cleaned.length === 0) return undefined;

  const primary = cleaned[0];
  const secondary = cleaned.slice(1);
  const restMean =
    secondary.length === 0
      ? 0
      : secondary.reduce((a, n) => a + n.confidence, 0) / secondary.length;
  const coherenceScore = Math.max(
    0,
    Math.min(100, Math.round(primary.confidence - restMean)),
  );

  const ambiguity: NicheCoherence["ambiguity"] =
    coherenceScore >= 50 ? "low" : coherenceScore >= 25 ? "medium" : "high";

  const positioning =
    ambiguity === "low"
      ? `Sits clearly in "${primary.label}" — Google can confidently classify this in one topical cluster.`
      : ambiguity === "medium"
        ? `Leans toward "${primary.label}" but bleeds into ${secondary.map((s) => `"${s.label}"`).join(" / ")}, which weakens topical authority.`
        : `Spread across ${[primary, ...secondary].map((s) => `"${s.label}"`).join(", ")} — no single niche to amplify into; ranking signals fragment.`;

  const recommendation =
    ambiguity === "low"
      ? `Hold the line: every new page should reinforce "${primary.label}" terminology.`
      : ambiguity === "medium"
        ? `Pick "${primary.label}" or "${secondary[0]?.label ?? "the secondary niche"}" and rewrite the hero + about copy to commit fully — kill the dual-positioning.`
        : `Site is identity-confused. Rewrite the homepage around a single niche; move other offerings to dedicated subpages so the root URL signals one cluster.`;

  return {
    primary,
    secondary,
    coherenceScore,
    ambiguity,
    positioning,
    recommendation,
  };
}

// ── Attention / first-impression (Claude vision on the screenshots) ─────────
function base64ToImageBlock(b64: string) {
  // Capture module returns raw base64 JPEG (no data: prefix).
  const data = b64.replace(/^data:[^,]+,/, "");
  return { type: "image" as const, source: { type: "base64" as const, media_type: "image/jpeg" as const, data } };
}

const GOAL_ATTENTION_LENS: Record<AuditGoal, string> = {
  sales:
    "The page's goal is SALES / CONVERSION. Judge the fold on how well it DRIVES ACTION: is there a prominent, action-clear primary CTA above the fold? Is the value proposition obvious in 3 seconds? Is there friction or distraction between the visitor and the action? Are there trust/proof signals near the CTA? Suggested check ids: value-prop, primary-cta, friction, trust-proof.",
  presentation:
    "The page's goal is PRESENTATION / BRAND. Judge the fold on FIRST IMPRESSION and craft: does it grab attention, does it feel like a distinct brand (not a template), can a stranger tell who this is and what it's about, is the visual hierarchy and polish strong? Suggested check ids: attention-grab, brand-feel, clarity-5s, visual-hierarchy.",
};

/** Judge ONE page on BOTH its desktop and mobile above-the-fold shots. */
async function runPageAttention(capture: PageCapture, goal: AuditGoal): Promise<PageAttention | null> {
  if (!capture.desktop && !capture.mobile) return null;

  const system = `You are a senior conversion + landing-page designer. You are shown the ABOVE-THE-FOLD screenshot(s) of a web page — what a visitor sees in the first ~3 seconds before scrolling — at one or both of DESKTOP and MOBILE widths. Judge the FIRST IMPRESSION only, separately for each viewport you are given. Not SEO, not performance.

${GOAL_ATTENTION_LENS[goal]}

Return ONLY a JSON object, nothing else. Include a key ONLY for the viewport(s) actually provided:
{
  "desktop": {
    "score": 0-100,
    "verdict": "one punchy sentence on the desktop first impression",
    "checks": [
      { "id": "kebab-id", "label": "Short label", "status": "ok"|"warn"|"fail", "detail": "what you actually see", "fix": "one concrete change" }
    ]
  },
  "mobile": { "score": 0-100, "verdict": "...", "checks": [ ... ] }
}

Give 3-4 checks per viewport. Be specific and visual — reference the actual headline, button, image, clutter, whitespace. Desktop and mobile can score differently (a fold that works on desktop often breaks on mobile). Calibrate: 50 = average, 75 = strong, 85+ = exceptional.`;

  const content: any[] = [];
  if (capture.desktop) {
    content.push({ type: "text", text: "DESKTOP above-the-fold (1440px):" });
    content.push(base64ToImageBlock(capture.desktop));
  }
  if (capture.mobile) {
    content.push({ type: "text", text: "MOBILE above-the-fold (390px):" });
    content.push(base64ToImageBlock(capture.mobile));
  }
  content.push({
    type: "text",
    text: `URL: ${capture.url}
Page title: ${capture.title || "(unknown)"}
Visible text (for context): ${(capture.heroText || "").slice(0, 600)}

Judge the first impression for each viewport shown. Return the JSON now.`,
  });

  const r = await createMessage({
    model: HAIKU_MODEL,
    max_tokens: 1400,
    system,
    messages: [{ role: "user", content }],
  });
  const text = r.content[0]?.type === "text" ? r.content[0].text : "{}";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: any = {};
  try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

  function viewport(raw: any): ViewportAttention | undefined {
    if (!raw || typeof raw !== "object") return undefined;
    return {
      score: typeof raw.score === "number" ? Math.max(0, Math.min(100, Math.round(raw.score))) : 50,
      verdict: typeof raw.verdict === "string" ? raw.verdict : "Could not read the first impression.",
      checks: Array.isArray(raw.checks) ? raw.checks.slice(0, 4) : [],
    };
  }

  // Upload the screenshots to Blob in parallel so the report stays small.
  const safeKey = capture.url.replace(/[^a-z0-9]+/gi, "-").slice(0, 60);
  const [desktopUrl, mobileUrl] = await Promise.all([
    capture.desktop ? uploadShot(capture.desktop, `${safeKey}-d`) : Promise.resolve(undefined),
    capture.mobile ? uploadShot(capture.mobile, `${safeKey}-m`) : Promise.resolve(undefined),
  ]);

  const desktop = capture.desktop ? viewport(parsed.desktop) : undefined;
  const mobile = capture.mobile ? viewport(parsed.mobile) : undefined;
  if (desktop) desktop.screenshot = desktopUrl;
  if (mobile) mobile.screenshot = mobileUrl;

  const scores = [desktop?.score, mobile?.score].filter((s): s is number => typeof s === "number");
  const score = scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : 50;
  // Back-compat top-level fields favour mobile (the original single-viewport axis).
  const primaryVp = mobile ?? desktop;

  return {
    url: capture.url,
    score,
    verdict: primaryVp?.verdict ?? "",
    checks: primaryVp?.checks ?? [],
    screenshot: primaryVp?.screenshot,
    desktop,
    mobile,
  };
}

/** Upload a base64 JPEG to Blob, return its public URL (undefined on failure). */
async function uploadShot(b64: string, key: string): Promise<string | undefined> {
  try {
    const token = process.env.BLOB_READ_WRITE_TOKEN ?? (import.meta as any).env?.BLOB_READ_WRITE_TOKEN;
    if (!token) return undefined;
    const bytes = Buffer.from(b64.replace(/^data:[^,]+,/, ""), "base64");
    const blob = await put(`audits/${key}.jpg`, bytes, {
      access: "public",
      contentType: "image/jpeg",
      token,
      addRandomSuffix: true,
    });
    return blob.url;
  } catch {
    return undefined;
  }
}

// ── Page discovery (sitemap.xml first, nav links as fallback) ───────────────
async function fetchSitemapUrls(origin: string): Promise<string[]> {
  async function loadXml(u: string): Promise<string> {
    const r = await fetch(u, { redirect: "follow", headers: { "User-Agent": "GrappesAuditBot/1.0" } });
    if (!r.ok) throw new Error(String(r.status));
    return r.text();
  }
  const out = new Set<string>();
  try {
    const xml = await loadXml(`${origin}/sitemap.xml`);
    const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => m[1]);
    // Sitemap index → fetch a few child sitemaps.
    if (/<sitemapindex/i.test(xml)) {
      const children = locs.filter((u) => /\.xml(\?|$)/i.test(u)).slice(0, 5);
      const childXmls = await Promise.allSettled(children.map(loadXml));
      for (const c of childXmls) {
        if (c.status === "fulfilled") {
          for (const m of c.value.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)) out.add(m[1]);
        }
      }
    } else {
      for (const u of locs) out.add(u);
    }
  } catch {
    /* no sitemap — caller falls back to nav links */
  }
  return [...out];
}

const ASSET_RE = /\.(jpg|jpeg|png|gif|svg|webp|avif|pdf|zip|mp4|css|js|json|xml|ico|woff2?|ttf)$/i;
const KEY_PAGE_RE = /(pricing|about|feature|product|service|contact|how|use-case|solution|portfolio|work|shop|store|book|demo|sign|order)/i;

/** Gather same-origin links from the homepage HTML. */
function linksFromHtml(homeUrl: string, html: string): string[] {
  const origin = new URL(homeUrl).origin;
  const out = new Set<string>();
  const linkRe = /<a\b[^>]*href=["']([^"'#?]+)[^"']*["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    const href = m[1].trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const u = new URL(href, homeUrl);
      if (u.origin !== origin) continue;
      out.add(u.toString());
    } catch { /* skip */ }
  }
  return [...out];
}

/**
 * Build the crawl list: homepage first, then key pages, then by depth, deduped
 * by path, capped at `max`. Returns the list plus whether the site had more.
 */
function buildCrawlList(homeUrl: string, candidates: string[], max: number): { pages: string[]; truncated: boolean } {
  const origin = new URL(homeUrl).origin;
  const byPath = new Map<string, string>(); // path -> full url
  byPath.set("/", homeUrl); // homepage always included
  for (const raw of candidates) {
    try {
      const u = new URL(raw, homeUrl);
      if (u.origin !== origin) continue;
      const path = u.pathname.replace(/\/+$/, "") || "/";
      if (ASSET_RE.test(path)) continue;
      if (!byPath.has(path)) byPath.set(path, `${origin}${path}`);
    } catch { /* skip */ }
  }
  const all = [...byPath.entries()].sort((a, b) => {
    if (a[0] === "/") return -1;
    if (b[0] === "/") return 1;
    const ka = KEY_PAGE_RE.test(a[0]) ? 0 : 1;
    const kb = KEY_PAGE_RE.test(b[0]) ? 0 : 1;
    if (ka !== kb) return ka - kb;
    return a[0].split("/").length - b[0].split("/").length;
  });
  return {
    pages: all.slice(0, max).map(([, u]) => u),
    truncated: all.length > max,
  };
}

/**
 * Whole-site attention: every page (capped at MAX_AUDIT_PAGES), each captured
 * at desktop AND mobile (with the cookie banner dismissed) and judged on both
 * folds. Captures run with bounded concurrency; the per-page vision calls run
 * in parallel after capture.
 */
async function runSiteAttention(params: {
  homeUrl: string;
  html: string;
  goal: AuditGoal;
  maxPages?: number;
}): Promise<AttentionReport | undefined> {
  const max = params.maxPages ?? MAX_AUDIT_PAGES;
  const origin = new URL(params.homeUrl).origin;

  const sitemapUrls = await fetchSitemapUrls(origin);
  const navUrls = linksFromHtml(params.homeUrl, params.html);
  const { pages: crawlUrls, truncated } = buildCrawlList(
    params.homeUrl,
    [...sitemapUrls, ...navUrls],
    max,
  );

  const captures = await capturePages(crawlUrls, { concurrency: 3 });
  const usable = captures.filter((c) => c.desktop || c.mobile);
  if (usable.length === 0) return undefined;

  const pageResults = await Promise.all(usable.map((c) => runPageAttention(c, params.goal)));
  const pages = pageResults.filter((p): p is PageAttention => p !== null);
  if (pages.length === 0) return undefined;

  // Primary = the submitted homepage if present, else the first page.
  const homePath = (() => { try { return new URL(params.homeUrl).pathname.replace(/\/+$/, "") || "/"; } catch { return "/"; } })();
  const primary = pages.find((p) => { try { return (new URL(p.url).pathname.replace(/\/+$/, "") || "/") === homePath; } catch { return false; } }) ?? pages[0];
  const siteScore = Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length);

  return {
    score: primary.score,
    verdict: primary.verdict,
    checks: primary.checks,
    pages,
    siteScore,
    goal: params.goal,
    pagesCrawled: pages.length,
    pagesTruncated: truncated,
  };
}

// ── Main orchestrator ───────────────────────────────────────────────────────
export async function runAudit(
  rawUrl: string,
  opts?: { goal?: AuditGoal },
): Promise<AuditReport> {
  const goal: AuditGoal = opts?.goal === "presentation" ? "presentation" : "sales";

  let url: URL;
  try {
    url = new URL(rawUrl);
    if (!["http:", "https:"].includes(url.protocol)) throw new Error("not http(s)");
  } catch {
    throw new Error("Invalid URL");
  }

  const errors: Record<string, string> = {};

  // Fetch HTML up-front (used by HTML checks + Claude content)
  let html = "";
  try {
    const r = await fetch(url.toString(), {
      redirect: "follow",
      headers: { "User-Agent": "GrappesAuditBot/1.0 (+https://grappes.dev/audit)" },
    });
    if (!r.ok) throw new Error(`fetch ${r.status}`);
    html = await r.text();
  } catch (e) {
    errors.fetch = e instanceof Error ? e.message : String(e);
  }

  const htmlChecks = html
    ? runHtmlChecks(html, url.toString())
    : { onpage: [] as AuditCheck[], technical: [] as AuditCheck[], mainText: "", title: "" };

  // Run PSI + robots/sitemap + content analysis in parallel
  const [perfResult, robotsResult, contentResult] = await Promise.allSettled([
    runPSI(url.toString()),
    checkRobotsAndSitemap(url.toString()),
    html ? runContentAnalysis({ url: url.toString(), title: htmlChecks.title, mainText: htmlChecks.mainText, goal })
         : Promise.reject(new Error("html unavailable")),
  ]);

  let perf: PerfReport | undefined;
  if (perfResult.status === "fulfilled") perf = perfResult.value;
  else errors.perf = perfResult.reason instanceof Error ? perfResult.reason.message : String(perfResult.reason);

  if (robotsResult.status === "fulfilled") {
    htmlChecks.technical.push(...robotsResult.value);
  } else {
    errors.robots = String(robotsResult.reason);
  }

  let content: ContentReport | undefined;
  if (contentResult.status === "fulfilled") content = contentResult.value;
  else errors.content = contentResult.reason instanceof Error ? contentResult.reason.message : String(contentResult.reason);

  // Attention lens — every page (capped), each captured at desktop + mobile
  // (cookie banner dismissed) and judged on both folds for the chosen goal.
  let attention: AttentionReport | undefined;
  if (html) {
    try {
      attention = await runSiteAttention({
        homeUrl: url.toString(),
        html,
        goal,
      });
      if (!attention) errors.attention = "Could not capture any page screenshot.";
    } catch (e) {
      errors.attention = e instanceof Error ? e.message : String(e);
    }
  } else {
    errors.attention = "Page HTML unavailable — skipped attention analysis.";
  }

  // Compute category scores
  const onpageScore = scoreChecks(htmlChecks.onpage);
  const technicalScore = scoreChecks(htmlChecks.technical);
  const perfScore = perf?.score ?? 50;
  const contentScore = content?.score ?? 50;
  // Weighted overall: perf 30%, onpage 25%, technical 25%, content 20%
  const overall = Math.round(
    perfScore * 0.3 + onpageScore * 0.25 + technicalScore * 0.25 + contentScore * 0.2,
  );

  return {
    url: url.toString(),
    fetchedAt: new Date().toISOString(),
    goal,
    perf,
    onpage: htmlChecks.onpage,
    technical: htmlChecks.technical,
    content,
    attention,
    errors,
    scores: {
      overall,
      perf: perfScore,
      onpage: onpageScore,
      technical: technicalScore,
      content: contentScore,
      attention: attention?.score,
    },
  };
}
