// ─── Post-Generation QA ──────────────────────────────────────────────────────
// Brief-aware checks that run after creative-generation completes:
//   - Logo / OG / video used if uploaded
//   - All architecture sections present in HTML
//   - No placeholder text (Lorem ipsum, [Your text], TODO, FIXME, etc.)
//   - Internal anchor links resolve to existing IDs
//   - Subjective Haiku pass: "does this match the brief?"
//
// Output: { score, issues } merged with structural QA report.

import { createMessage, HAIKU_MODEL, INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN } from './anthropic';

export interface PostQAIssue {
  severity: 'error' | 'warning' | 'info';
  area:     string;
  message:  string;
}

export interface PostQAReport {
  score:           number;            // 0-100
  issues:          PostQAIssue[];
  haikuVerdict?:   string;            // free-text summary from Haiku
  haikuCostUsd?:   number;
  haikuTokensIn?:  number;
  haikuTokensOut?: number;
}

const PLACEHOLDER_PATTERNS: Array<{ re: RegExp; label: string }> = [
  { re: /\blorem\s+ipsum\b/gi,                  label: 'Lorem ipsum' },
  { re: /\[\s*your\s+(text|name|company|email)[^\]]*\]/gi, label: '[Your text/name/company/email]' },
  { re: /\[\s*placeholder[^\]]*\]/gi,           label: '[placeholder]' },
  { re: /\bTODO[: ]/g,                          label: 'TODO marker' },
  { re: /\bFIXME[: ]/g,                         label: 'FIXME marker' },
  { re: /\bXXX[: ]/g,                           label: 'XXX marker' },
  { re: /\bPLACEHOLDER\b/g,                     label: 'PLACEHOLDER' },
];

function checkPlaceholders(html: string): PostQAIssue[] {
  const issues: PostQAIssue[] = [];
  // Strip <style> and <script> first so we don't false-positive on JS keywords
  const stripped = html.replace(/<style[\s\S]*?<\/style>/gi, '').replace(/<script[\s\S]*?<\/script>/gi, '');
  for (const { re, label } of PLACEHOLDER_PATTERNS) {
    const matches = stripped.match(re);
    if (matches && matches.length > 0) {
      issues.push({ severity: 'error', area: 'placeholder-text', message: `${label} found ${matches.length}× in visible content` });
    }
  }
  return issues;
}

function checkBrandAssetUsage(html: string, brief: any, assets: Array<{ type: string; url: string }>): PostQAIssue[] {
  const issues: PostQAIssue[] = [];

  const logoUploaded = assets.some(a => a.type === 'logo') || !!brief?.branding?.logo;
  if (logoUploaded) {
    const logoUrl = assets.find(a => a.type === 'logo')?.url || brief?.branding?.logo;
    if (logoUrl && !html.includes(logoUrl)) {
      issues.push({ severity: 'error', area: 'brand-asset', message: 'Uploaded logo not used anywhere in the generated HTML' });
    }
  }

  const ogUploaded = assets.some(a => a.type === 'og') || !!brief?.media?.ogImage;
  if (ogUploaded) {
    const ogUrl = assets.find(a => a.type === 'og')?.url || brief?.media?.ogImage;
    if (ogUrl && !html.includes(ogUrl)) {
      issues.push({ severity: 'warning', area: 'brand-asset', message: 'Uploaded OG image not referenced in <meta property="og:image">' });
    }
  }

  return issues;
}

function checkArchitectureSections(html: string, expectedSections: string[]): PostQAIssue[] {
  if (!expectedSections || expectedSections.length === 0) return [];
  const missing = expectedSections.filter(s => {
    const re = new RegExp(`<!--\\s*SECTION:${s}\\s*-->|data-section=["']${s}["']`, 'i');
    return !re.test(html);
  });
  if (missing.length === 0) return [];
  return [{
    severity: 'warning',
    area:     'architecture',
    message:  `Expected sections missing from HTML: ${missing.join(', ')}`,
  }];
}

function checkInternalAnchors(html: string): PostQAIssue[] {
  const anchorTargets = new Set<string>();
  for (const m of html.matchAll(/\bid=["']([^"']+)["']/gi)) anchorTargets.add(m[1]);
  for (const m of html.matchAll(/data-section=["']([^"']+)["']/gi)) anchorTargets.add(m[1]);

  const broken: string[] = [];
  for (const m of html.matchAll(/href=["']#([^"'\s]+)["']/gi)) {
    const target = m[1];
    if (!target || target === 'top') continue;
    if (!anchorTargets.has(target)) broken.push(target);
  }
  if (broken.length === 0) return [];
  const unique = [...new Set(broken)];
  return [{
    severity: 'warning',
    area:     'internal-links',
    message:  `Broken anchor link(s): #${unique.slice(0, 5).join(', #')}${unique.length > 5 ? '…' : ''}`,
  }];
}

async function runHaikuQA(brief: any, html: string): Promise<{ score: number; issues: PostQAIssue[]; verdict: string; tokensIn: number; tokensOut: number }> {
  // Trim HTML to avoid huge prompts — Haiku just needs visible structure.
  const stripped = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/\s+/g, ' ')
    .slice(0, 18000);

  const briefSummary = JSON.stringify({
    business:    brief?.business,
    target:      brief?.target_audience,
    content:     brief?.content,
    selectedSections: brief?.business?.selectedSections,
    contact:     brief?.contact,
    locale:      brief?.business?.locale,
    socials:     brief?.social,
  }, null, 0).slice(0, 6000);

  const sys = `You are a QA reviewer for AI-generated marketing websites. You receive a client brief (JSON) and the generated HTML (visible content only — styles/scripts removed). Verify the HTML matches the brief.

Output ONLY a JSON object on a single line, no prose, no markdown fences:
{"score": <0-100>, "issues": [{"severity": "error"|"warning"|"info", "area": "<short>", "message": "<one sentence>"}], "verdict": "<one sentence overall verdict>"}

Score guide:
- 90-100: matches brief, real content, no placeholders, all sections present
- 70-89: matches brief but has minor issues (a few weak spots, generic copy)
- 40-69: significant mismatches (missing sections, generic content, wrong tone)
- 0-39: serious problems (placeholder content everywhere, wrong industry, broken structure)

Look for: missing sections from brief.business.selectedSections, generic/templated copy that ignores the brief, missing contact info, wrong language/locale, missing testimonials/services if listed in brief, sections that don't match what was promised.`;

  const user = `## Brief\n${briefSummary}\n\n## Generated HTML (visible content)\n${stripped}`;

  const res = await createMessage({
    model:      HAIKU_MODEL,
    max_tokens: 1500,
    system:     sys,
    messages:   [{ role: 'user', content: user }],
  });

  const raw = res.content[0]?.type === 'text' ? res.content[0].text : '';
  const tokensIn  = res.usage?.input_tokens  ?? 0;
  const tokensOut = res.usage?.output_tokens ?? 0;

  let parsed: { score?: number; issues?: PostQAIssue[]; verdict?: string } = {};
  try {
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    parsed = JSON.parse(cleaned);
  } catch {
    parsed = { score: 70, issues: [], verdict: 'Could not parse QA output — defaulting to 70.' };
  }

  return {
    score:    typeof parsed.score === 'number' ? Math.max(0, Math.min(100, parsed.score)) : 70,
    issues:   Array.isArray(parsed.issues) ? parsed.issues : [],
    verdict:  parsed.verdict ?? 'No verdict returned.',
    tokensIn,
    tokensOut,
  };
}

export async function runPostQA(opts: {
  html:              string;
  brief:             any;
  assets:            Array<{ type: string; url: string }>;
  expectedSections?: string[];
  skipHaiku?:        boolean;
}): Promise<PostQAReport> {
  const { html, brief, assets, expectedSections, skipHaiku } = opts;

  // Deterministic checks (free, fast)
  const issues: PostQAIssue[] = [
    ...checkPlaceholders(html),
    ...checkBrandAssetUsage(html, brief, assets),
    ...checkArchitectureSections(html, expectedSections ?? []),
    ...checkInternalAnchors(html),
  ];

  // Subjective Haiku pass (skippable if we want to save cost)
  let haikuVerdict: string | undefined;
  let haikuScore = 100;
  let costUsd = 0;
  let tokIn  = 0;
  let tokOut = 0;
  if (!skipHaiku) {
    try {
      const h = await runHaikuQA(brief, html);
      issues.push(...h.issues);
      haikuVerdict = h.verdict;
      haikuScore   = h.score;
      tokIn  = h.tokensIn;
      tokOut = h.tokensOut;
      costUsd = tokIn * INPUT_COST_PER_TOKEN + tokOut * OUTPUT_COST_PER_TOKEN;
    } catch (e) {
      console.warn('[post-qa] Haiku check failed (non-fatal):', e);
      haikuVerdict = 'Haiku QA unavailable.';
    }
  }

  // Combine: each error -10, warning -3, info -1 — capped to [0, haikuScore]
  let deductions = 0;
  for (const i of issues) {
    if (i.severity === 'error')   deductions += 10;
    if (i.severity === 'warning') deductions += 3;
    if (i.severity === 'info')    deductions += 1;
  }
  const score = Math.max(0, Math.min(haikuScore, 100 - deductions));

  return {
    score,
    issues,
    haikuVerdict,
    haikuCostUsd:   costUsd,
    haikuTokensIn:  tokIn,
    haikuTokensOut: tokOut,
  };
}
