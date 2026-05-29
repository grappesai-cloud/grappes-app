// ── SEO + performance audit orchestrator ─────────────────────────────────────
// Combines three signals into one report:
//   1. PageSpeed Insights (Google API) — performance + accessibility scores
//   2. HTML parsing (lib/audit-html-checks) — on-page + technical SEO
//   3. Claude Haiku — content/keyword analysis from the page's main text
//
// Each step is wrapped in try/catch so a failure in one doesn't kill the whole
// audit; the report shows what we could analyse and reports the rest as errors.

import { createMessage, HAIKU_MODEL } from "./anthropic";
import {
  runHtmlChecks,
  scoreChecks,
  type AuditCheck,
} from "./audit-html-checks";

const PSI_ENDPOINT =
  "https://www.googleapis.com/pagespeedonline/v5/runPagespeed";

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
export interface PageAttention {
  url: string;
  score: number; // 0-100
  verdict: string;
  checks: AuditCheck[];
  screenshot?: string; // data URI (above-the-fold)
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
}

export interface AuditReport {
  url: string;
  fetchedAt: string;
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
async function runContentAnalysis(params: {
  url: string;
  title: string;
  mainText: string;
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

Also check for: clear primary topic, keyword stuffing, thin content, missing structured sections (no clear intro/value-prop), readability, generic copy that could fit any business, mismatch between title and body.`;

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

// ── Attention / first-impression (Claude vision on the screenshot) ──────────
function dataUriToImageBlock(dataUri: string) {
  const m = dataUri.match(/^data:(image\/\w+);base64,(.+)$/s);
  const media_type = (m?.[1] ?? "image/jpeg") as
    | "image/jpeg"
    | "image/png"
    | "image/webp";
  const data = m?.[2] ?? dataUri.replace(/^data:[^,]+,/, "");
  return { type: "image" as const, source: { type: "base64" as const, media_type, data } };
}

async function runAttentionAnalysis(params: {
  url: string;
  title?: string;
  heroText?: string;
  screenshot: string;
}): Promise<PageAttention> {
  const system = `You are a senior conversion + landing-page designer. You are shown the ABOVE-THE-FOLD mobile screenshot of a web page (what a visitor sees in the first ~3 seconds before scrolling). Judge the FIRST IMPRESSION only — not SEO, not performance.

Return ONLY a JSON object, nothing else:
{
  "score": 0-100,
  "verdict": "one punchy sentence on the first impression",
  "checks": [
    { "id": "attention-grab", "label": "Attention grab", "status": "ok"|"warn"|"fail", "detail": "what the eye lands on first", "fix": "one concrete change" },
    { "id": "clarity-5s", "label": "5-second clarity", "status": "ok"|"warn"|"fail", "detail": "can a stranger tell what this is/does instantly?", "fix": "..." },
    { "id": "visual-hierarchy", "label": "Visual hierarchy", "status": "ok"|"warn"|"fail", "detail": "is the eye guided in a clear order toward the action?", "fix": "..." },
    { "id": "cta", "label": "Primary CTA", "status": "ok"|"warn"|"fail", "detail": "is there a prominent, action-clear CTA above the fold?", "fix": "..." }
  ]
}

Be specific and visual — reference what you actually see (headline, button, image, clutter, whitespace). 'score' reflects how well the fold captures attention AND communicates value in 3s. Calibrate: 50 = average, 75 = strong, 85+ = exceptional.`;

  const user = `URL: ${params.url}
Page title: ${params.title ?? "(unknown)"}
Hero/visible text (for context): ${(params.heroText ?? "").slice(0, 600)}

Judge the screenshot's first impression. Return the JSON now.`;

  const r = await createMessage({
    model: HAIKU_MODEL,
    max_tokens: 900,
    system,
    messages: [
      {
        role: "user",
        content: [dataUriToImageBlock(params.screenshot), { type: "text", text: user }],
      },
    ],
  });
  const text = r.content[0]?.type === "text" ? r.content[0].text : "{}";
  const cleaned = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```\s*$/, "").trim();
  let parsed: any = {};
  try { parsed = JSON.parse(cleaned); } catch { /* fall through */ }

  return {
    url: params.url,
    score: typeof parsed.score === "number" ? Math.max(0, Math.min(100, Math.round(parsed.score))) : 50,
    verdict: typeof parsed.verdict === "string" ? parsed.verdict : "Could not read the first impression.",
    checks: Array.isArray(parsed.checks) ? parsed.checks.slice(0, 4) : [],
    screenshot: params.screenshot,
  };
}

/** Discover up to `max` key same-origin pages from the homepage nav links. */
function discoverPages(homeUrl: string, html: string, max: number): string[] {
  const origin = new URL(homeUrl).origin;
  const found = new Map<string, number>(); // url -> priority (lower = better)
  const linkRe = /<a\b[^>]*href=["']([^"'#?]+)[^"']*["']/gi;
  let m: RegExpExecArray | null;
  while ((m = linkRe.exec(html)) !== null) {
    let href = m[1].trim();
    if (!href || href.startsWith("mailto:") || href.startsWith("tel:")) continue;
    try {
      const u = new URL(href, homeUrl);
      if (u.origin !== origin) continue;
      const path = u.pathname.replace(/\/$/, "") || "/";
      if (path === "/") continue; // homepage handled separately
      if (/\.(jpg|jpeg|png|gif|svg|webp|pdf|zip|mp4|css|js)$/i.test(path)) continue;
      const depth = path.split("/").filter(Boolean).length;
      // Prefer shallow, "key" pages (pricing/about/features/contact/product).
      const keyBoost = /(pricing|about|feature|product|service|contact|how|use-case|solution)/i.test(path) ? -2 : 0;
      const prio = depth + keyBoost;
      const clean = `${origin}${path}`;
      if (!found.has(clean) || found.get(clean)! > prio) found.set(clean, prio);
    } catch {
      /* skip bad href */
    }
  }
  return [...found.entries()]
    .sort((a, b) => a[1] - b[1])
    .slice(0, max)
    .map(([u]) => u);
}

/** Minimal PSI call that only extracts the Lighthouse screenshot for a URL. */
async function getScreenshotOnly(url: string): Promise<string | undefined> {
  try {
    const apiKey = import.meta.env.PSI_API_KEY ?? process.env.PSI_API_KEY;
    if (!apiKey) return undefined;
    const params = new URLSearchParams({ url, strategy: "mobile", key: apiKey, category: "performance" });
    const r = await fetch(`${PSI_ENDPOINT}?${params}`);
    if (!r.ok) return undefined;
    const data = (await r.json()) as any;
    return (data.lighthouseResult?.audits?.["final-screenshot"]?.details?.data as string | undefined) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * Whole-site attention: the submitted page + a few key discovered pages, each
 * screenshotted and judged. PSI screenshot fetches and vision calls run in
 * PARALLEL so wall-time stays close to a single page (audit runs in-request).
 */
async function runSiteAttention(params: {
  homeUrl: string;
  homeScreenshot?: string;
  homeTitle: string;
  homeHeroText: string;
  html: string;
  maxPages?: number;
}): Promise<AttentionReport | undefined> {
  const max = params.maxPages ?? 4;
  const subPaths = discoverPages(params.homeUrl, params.html, max - 1);

  // Fetch sub-page screenshots in parallel; homepage reuses the perf screenshot.
  const subShots = await Promise.all(subPaths.map((u) => getScreenshotOnly(u)));

  const targets: { url: string; title?: string; heroText?: string; screenshot: string }[] = [];
  if (params.homeScreenshot)
    targets.push({ url: params.homeUrl, title: params.homeTitle, heroText: params.homeHeroText, screenshot: params.homeScreenshot });
  subPaths.forEach((u, i) => {
    const shot = subShots[i];
    if (shot) targets.push({ url: u, screenshot: shot });
  });

  if (targets.length === 0) return undefined;

  const pages = await Promise.all(targets.map((t) => runAttentionAnalysis(t)));
  const primary = pages[0];
  const siteScore = Math.round(pages.reduce((a, p) => a + p.score, 0) / pages.length);

  return {
    score: primary.score,
    verdict: primary.verdict,
    checks: primary.checks,
    pages,
    siteScore,
  };
}

// ── Main orchestrator ───────────────────────────────────────────────────────
export async function runAudit(rawUrl: string): Promise<AuditReport> {
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
    html ? runContentAnalysis({ url: url.toString(), title: htmlChecks.title, mainText: htmlChecks.mainText })
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

  // Attention lens — submitted page + a few key pages (parallel), each judged
  // on its above-the-fold screenshot. Needs the Lighthouse screenshot + HTML.
  let attention: AttentionReport | undefined;
  if (perf?.screenshot && html) {
    try {
      attention = await runSiteAttention({
        homeUrl: url.toString(),
        homeScreenshot: perf.screenshot,
        homeTitle: htmlChecks.title,
        homeHeroText: htmlChecks.mainText,
        html,
      });
    } catch (e) {
      errors.attention = e instanceof Error ? e.message : String(e);
    }
  } else if (!errors.perf) {
    errors.attention = "No screenshot available from Lighthouse.";
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
