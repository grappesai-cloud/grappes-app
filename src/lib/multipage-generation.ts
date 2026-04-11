// ─── Multi-Page Generation ───────────────────────────────────────────────────
// When brief.preferences.websiteType === "multi-page", generates each page
// as a separate HTML file sharing consistent nav, footer, and styles.
// Falls back to single-page if multi-page generation fails.

import { createMessage } from './anthropic';
import { SONNET_MODEL, SONNET_INPUT_COST, SONNET_OUTPUT_COST } from './generation';
import { CREATIVE_SYSTEM_PROMPT, extractHtml, buildUserPrompt } from './creative-generation';
import type { BriefData, AssetData } from './creative-generation';

export interface PageFile {
  slug: string;      // e.g. "index", "about", "services"
  filename: string;  // e.g. "index.html", "about.html"
  title: string;
  html: string;
}

export interface PageMeta {
  slug: string;
  filename: string;
  title: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

export function getPagesList(brief: BriefData): PageMeta[] {
  const pages: string[] = brief?.content?.pages || ['Home', 'About', 'Services', 'Contact'];
  return pages.map(name => {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    return {
      slug: slug === 'home' ? 'index' : slug,
      filename: slug === 'home' ? 'index.html' : `${slug}.html`,
      title: name,
    };
  });
}

export function extractDesignRef(homeHtml: string): string {
  const styleMatch = homeHtml.match(/<style[\s\S]*?<\/style>/);
  const navMatch   = homeHtml.match(/<!-- SECTION:nav -->[\s\S]*?<!-- \/SECTION:nav -->/);
  const footerMatch = homeHtml.match(/<!-- SECTION:footer -->[\s\S]*?<!-- \/SECTION:footer -->/);
  return [styleMatch?.[0], navMatch?.[0], footerMatch?.[0]].filter(Boolean).join('\n\n');
}

// ── Single-page generation ────────────────────────────────────────────────────

export async function generateOnePage(params: {
  brief: BriefData;
  assets: AssetData[];
  allPages: string[];   // all page title names (for nav links)
  pageIndex: number;    // 0 = home page
  homeDesignRef: string; // extracted design ref from home; empty for home itself
}): Promise<{ page: PageFile; cost: number; tokens: { input: number; output: number } }> {
  const { brief, assets, allPages, pageIndex, homeDesignRef } = params;

  const pageName = allPages[pageIndex];
  const slug = pageName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  const filename = slug === 'home' ? 'index.html' : `${slug}.html`;
  const isHome = pageIndex === 0;

  const pagePrompt = buildPagePrompt(brief, assets, allPages, pageName, isHome, homeDesignRef);

  console.log(`[multipage] Generating page ${pageIndex + 1}/${allPages.length}: ${pageName} (${filename})`);

  const response = await createMessage({
    model: SONNET_MODEL,
    max_tokens: 64000,
    system: MULTIPAGE_SYSTEM,
    messages: [{ role: 'user', content: pagePrompt }],
  });

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  let inputTokens = response.usage?.input_tokens ?? 0;
  let outputTokens = response.usage?.output_tokens ?? 0;

  let html = extractHtml(raw);
  let combinedRaw = raw;

  // Up to 3 continuations if truncated (matching single-page behavior)
  for (let cont = 0; cont < 3 && !html.includes('</html>'); cont++) {
    console.log(`[multipage] Page "${pageName}" truncated (${html.length} chars) — continuation ${cont + 1}/3`);
    const contResponse = await createMessage({
      model: SONNET_MODEL,
      max_tokens: 64000,
      system: MULTIPAGE_SYSTEM,
      messages: [
        { role: 'user', content: pagePrompt },
        { role: 'assistant', content: combinedRaw },
        { role: 'user', content: 'Continue EXACTLY where you left off. Do not repeat any HTML already written. Complete through </html>.' },
      ],
    });
    const contRaw = contResponse.content[0]?.type === 'text' ? contResponse.content[0].text : '';
    inputTokens += contResponse.usage?.input_tokens ?? 0;
    outputTokens += contResponse.usage?.output_tokens ?? 0;
    combinedRaw += '\n' + contRaw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    html = extractHtml(combinedRaw);
  }

  if (!html.includes('</html>')) {
    console.error(`[multipage] Page "${pageName}" still truncated after 3 continuations (${html.length} chars)`);
    if (isHome) throw new Error(`Home page HTML incomplete after 3 continuations`);
    // Inner pages: append closing tags as best-effort fallback
    html += '\n</body>\n</html>';
  }

  return {
    page: {
      slug: slug === 'home' ? 'index' : slug,
      filename,
      title: pageName,
      html,
    },
    cost: inputTokens * SONNET_INPUT_COST + outputTokens * SONNET_OUTPUT_COST,
    tokens: { input: inputTokens, output: outputTokens },
  };
}

const MULTIPAGE_SYSTEM = CREATIVE_SYSTEM_PROMPT + `

## Multi-page rules

You are generating ONE PAGE of a multi-page website. All pages share the same design language:
- Same color palette, fonts, and overall style
- Same navigation bar (with links to all pages, current page highlighted)
- Same footer
- Consistent section styling

The navigation must link between pages using relative hrefs (e.g. href="about.html", href="index.html").
The current page's nav link should have an "is-active" class or similar visual indicator.

Each page is a complete self-contained HTML file (with its own <head>, styles, scripts).`;

function buildPagePrompt(
  brief: BriefData,
  assets: AssetData[],
  allPages: string[],
  currentPage: string,
  isHome: boolean,
  previousDesign: string
): string {
  const basePrompt = buildUserPrompt(brief, assets);

  const pageNav = allPages.map(p => {
    const slug = p.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
    const href = slug === 'home' ? 'index.html' : `${slug}.html`;
    const active = p === currentPage ? ' (CURRENT PAGE — add is-active class)' : '';
    return `- ${p} → ${href}${active}`;
  }).join('\n');

  let pageInstruction: string;

  if (isHome) {
    pageInstruction = `Generate the HOME PAGE (index.html). This is the main landing page — hero, key sections, CTA. Set the design direction for all other pages.`;
  } else {
    pageInstruction = `Generate the "${currentPage}" page (${currentPage.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.html).
This is an inner page — it should match the design language established by the home page.

Here are the styles, navigation, and footer from the home page — reuse them exactly:

${previousDesign}

Build unique content sections appropriate for a "${currentPage}" page.`;
  }

  return `${basePrompt}

## Page-Specific Instructions

${pageInstruction}

## Navigation Links (for ALL pages)

${pageNav}

Generate ONLY the ${currentPage} page. Output the complete HTML file.`;
}
