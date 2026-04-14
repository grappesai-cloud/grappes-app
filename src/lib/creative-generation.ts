// ─── Creative Generation Engine ──────────────────────────────────────────────
// Replaces the 2,375-line html-generation.ts with a prompt-based creative
// generation approach. Single Sonnet call produces a complete HTML file.
// No personas, no design specs, no rigid rules — just a great prompt.

import { createMessage, HAIKU_MODEL } from './anthropic';
import { db } from './db';
import { SONNET_MODEL, SONNET_INPUT_COST, SONNET_OUTPUT_COST, OPUS_MODEL, OPUS_INPUT_COST, OPUS_OUTPUT_COST } from './generation';
import { EFFECT_RUNTIMES, EFFECTS_DOCS } from './effects';
import { INVERTED_CORNERS_JS, INVERTED_CORNERS_DOCS } from './inverted-corners';

// Re-export for launch.ts convenience
export { SONNET_MODEL, SONNET_INPUT_COST, SONNET_OUTPUT_COST };
export const FULL_PAGE_KEY = '__html__full';

// ─── Types ───────────────────────────────────────────────────────────────────

export type BriefData = Record<string, any>;

export interface AssetData {
  type: string;
  url: string;
  sectionId?: string;
  variants?: Record<string, string>;
}

// ─── Effect Runtimes & Docs (for system prompt + post-generation injection) ──

const ALL_RUNTIMES: Record<string, string> = {
  ...EFFECT_RUNTIMES,
  __invertCorners: INVERTED_CORNERS_JS,
};

const ALL_DOCS: Record<string, string> = {
  ...EFFECTS_DOCS,
  invertCorners: INVERTED_CORNERS_DOCS,
};

// ─── Creative System Prompt ──────────────────────────────────────────────────

export const CREATIVE_SYSTEM_PROMPT = `You are an elite creative director and front-end developer who crafts immersive digital experiences. Every site you build is unlike anything you've built before.

## Toolkit

Single self-contained HTML file. Everything inline:
- CSS in <style>, JS in <script>
- GSAP 3.12 + ScrollTrigger + ScrollToPlugin (CDN: https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/)
- Lenis smooth scroll (CDN: https://unpkg.com/lenis@1.1.18/dist/lenis.min.js)
- Google Fonts (2-3 families max, with preconnect)
- Images: only use assets the client has uploaded (provided in "Uploaded Assets"). Never fetch from Unsplash, Pexels, or any stock photo service. If the client has no uploaded image for a section, do NOT insert a placeholder — design that section with typography, color, geometric CSS shapes, gradients, or canvas instead. If brief has media.no_photos=true, use ZERO <img> tags anywhere and build the entire experience with typography and CSS.

## Your creative process

Before you write code, make three decisions:

1. THE CONCEPT — One sentence that captures THIS brand as a physical sensation. Not abstract. Something you can feel, see, smell. This drives every choice.

2. THE SIGNATURE — One interaction visitors will screenshot. Not a common effect — something that could ONLY exist on this site for this brand. Something that makes a developer ask "how did they do that?"

3. THE FLOW — Think in TIME, not in sections. How does the visitor's 60-second journey unfold?

## Quality

- Typography: clamp() fluid sizing, weight contrast, letter-spacing. Type alone should be beautiful.
- Whitespace: generous. Nothing cramped.
- Animation: dramatic, not subtle. If a visitor can't tell something was animated, you failed.
- Responsive: 1024/768/480px breakpoints. Mobile is first-class.
- Color: derived from brand, never from defaults.

## The golden rule

Think in MOMENTS, not sections. Content FLOWS — elements overlap, images bleed, text floats over visuals.

If you catch yourself repeating a layout pattern you've already used on the page — STOP and find another way.

## The creativity test

For every animation and interaction you add, ask: "Could this exist on ANY other website?" If yes — it's not good enough. Replace it with something that could ONLY exist for THIS specific brand.

A ceramics studio might have elements that crack and reform like clay. An electric company might have current flowing between elements. A fashion designer might have fabric-like physics on hover. The interaction IS the brand — not decoration on top of it.

Use the full power of GSAP, ScrollTrigger, canvas, clip-path, CSS transforms — but in service of THIS brand's story, not as generic effects.

## Pre-built effects (available — use ONLY if one genuinely fits this brand's concept)

These runtime functions are auto-injected if you call them. Using zero is fine — inventing your own is better if none fits.
- window.__textType(el, { texts, speed, deleteSpeed, pauseMs, cursor }) — typing/deleting text loop
- window.__textPressure(el, { text, minWeight, maxWeight, radius }) — characters respond to mouse proximity via font-variation-settings (needs variable font)
- window.__variableProximity(el, { text, fromSettings, toSettings, radius, falloff }) — characters interpolate between font states on hover
- window.__curvedLoop(el, { text, speed, curveAmount, direction }) — text follows a Bézier curve, loops as marquee
- window.__scrollStack(container, { cardSelector, scaleStep, rotateStep, blurStep }) — cards stack/overlap as user scrolls (container needs height ~300vh)
- window.__pillNav(navEl, { pillColor, pillTextColor }) — morphing pill indicator slides between nav links
- window.__flowingMenu(ul, { speed, marqueeBg, marqueeColor, itemHeight }) — full-width menu items with marquee overlay on hover
- window.__invertCorners(el, { tl, tr, bl, br }) — clip-path with concave (inverted) corners, responsive

## Technical

- <!DOCTYPE html> through </html>. <meta charset>, viewport, <title>, og tags.
- One <h1>. All <img> with alt. <html lang>.
- Wrap content areas: <!-- SECTION:name --> <div data-section="name">...</div> <!-- /SECTION:name -->
- Mobile hamburger. @media (prefers-reduced-motion: reduce). Plain JS only.
- Connect Lenis: lenis.on('scroll', ScrollTrigger.update)
- For icons use inline SVGs or Unicode — no external icon library needed.
- Sections must not visually bleed into each other by accident. If you use position:absolute or oversized elements, ensure they stay within their section's bounds (overflow:hidden or clip). Intentional overlap between sections is fine — accidental overlap is a bug.

## Complexity

essential = tight, few moments. complete = rich journey. showcase = epic experience. Default: complete.

## Critical

- Output ONLY the complete HTML. No explanation.
- Every word of copy: specific to THIS brand. No generic text.
- Be bold. Make something that stops the scroll.`;

// ─── Reference Pool ──────────────────────────────────────────────────────────

// Reference pool and freshness notes removed — Sonnet knows Awwwards sites
// from training and produces more diverse results without hardcoded references
// that anchor it to the same 12 sites every time.

// Creative seed, art direction, and brand narrative replaced by Opus Creative Plan

// ─── Build User Prompt ───────────────────────────────────────────────────────

export function buildUserPrompt(
  brief: BriefData,
  assets: AssetData[],
  creativePlan?: string,
  rawConversation?: string
): string {
  // Website locale: explicit instruction to Sonnet so all copy comes out in the right language.
  const siteLocale = (brief as any)?.business?.locale || 'en';
  const localeNames: Record<string, string> = {
    ro: 'Romanian', en: 'English', fr: 'French', de: 'German',
    es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
    pl: 'Polish', hu: 'Hungarian',
  };
  const siteLangLabel = localeNames[siteLocale] || siteLocale;
  const languageDirective = `\n## Language — MANDATORY\nWrite ALL visible copy on the site (headlines, body text, nav labels, buttons, form placeholders, alt text, footer) in ${siteLangLabel}. The ONLY exceptions are: proper nouns, brand names, and any text marked [EXACT] in the sacred-content block — those stay verbatim. Do NOT mix languages.\n`;

  // Build asset lines for the prompt
  let assetLines = '';
  for (const asset of assets) {
    if (asset.type === 'logo' && asset.url) {
      assetLines += `\nLOGO IMAGE: ${asset.url} — use as <img> in nav and footer`;
    }
    if (asset.type === 'hero' && asset.url) {
      if (asset.variants && Object.keys(asset.variants).length > 0) {
        const variantEntries: string[] = [];
        if (asset.variants['640w']) variantEntries.push(`${asset.variants['640w']} 640w`);
        if (asset.variants['1280w']) variantEntries.push(`${asset.variants['1280w']} 1280w`);
        if (asset.variants['1920w']) variantEntries.push(`${asset.variants['1920w']} 1920w`);
        variantEntries.push(`${asset.url} 1920w`);
        if (variantEntries.length > 1) {
          const srcset = variantEntries.join(', ');
          assetLines += `\nHERO IMAGE: ${asset.url}`;
          assetLines += `\n  Responsive srcset: ${srcset}`;
          assetLines += `\n  For hero (LCP): add fetchpriority="high", remove loading="lazy"`;
        } else {
          assetLines += `\nHERO IMAGE: ${asset.url} — use as hero background or <img>`;
        }
      } else {
        assetLines += `\nHERO IMAGE: ${asset.url} — use as hero background or <img>`;
      }
    }
    if (asset.type === 'section' && asset.url && asset.sectionId) {
      assetLines += `\nSECTION IMAGE (${asset.sectionId}): ${asset.url}`;
    }
    if (asset.type === 'menu' && asset.url) {
      assetLines += `\nMENU PHOTO: ${asset.url} — reference only, menu data already extracted as content.menu in the brief`;
    }
    if (asset.type === 'og' && asset.url) {
      assetLines += `\nOG IMAGE: ${asset.url} — use for og:image meta tag`;
    }
  }

  // Video embed instruction
  const videoUrl = brief?.media?.videoUrl;
  const videoMode = brief?.media?.videoPlayMode || 'click';
  if (videoUrl) {
    assetLines += `\n\nVIDEO: ${videoUrl}
Play mode: ${videoMode === 'autoplay' ? 'autoplay when 50% visible in viewport' : 'click-to-play (show thumbnail + play button)'}
Embed as an iframe or video element with explicit dimensions (width:100%;aspect-ratio:16/9).`;
  }

  // If brief contains extracted menu data, add rendering instruction
  if (brief?.content?.menu?.categories?.length > 0) {
    assetLines += `\n\nMENU DATA: The brief contains content.menu with structured menu categories and items (extracted from a photo). Render this as a beautifully styled menu section — not a plain list. Think editorial restaurant menu: clean typography, category headers, item names with prices, subtle separators. This is real data from the client's actual menu.`;
  } else if (brief?.content?.menu_raw) {
    assetLines += `\n\nMENU DATA (raw text): The brief contains content.menu_raw with menu items extracted from a photo. Parse this text and render it as a styled menu section with categories, items, and prices.`;
  }

  const briefJson = JSON.stringify(brief, null, 2);

  // ── Surface high-value brief fields explicitly (don't bury in JSON) ─────────

  // Section context (descriptions as creative context, not verbatim copy)
  const rawSections = (brief?.content?.sections as Array<{id: string; title: string; description?: string}> | undefined) ?? [];
  const sectionsWithDesc = rawSections.filter(s => s.description);
  const sectionDescBlock = sectionsWithDesc.length > 0
    ? sectionsWithDesc.map(s => `- ${s.title} (id: ${s.id}): ${s.description}`).join('\n')
    : '';

  // Sacred content — things the client explicitly provided
  const sacredParts: string[] = [];
  const openingLine = brief?.content?.opening_line as string | undefined;
  if (openingLine) {
    sacredParts.push(`[EXACT] Hero headline: "${openingLine}"`);
  }
  const headline = brief?.content?.headline as string | undefined;
  if (headline && headline !== openingLine) {
    sacredParts.push(`[EXACT] Headline: "${headline}"`);
  }
  const testimonials = brief?.content?.testimonials as Array<{name?: string; role?: string; text: string}> | undefined;
  if (testimonials && testimonials.length > 0) {
    sacredParts.push('[EXACT] Testimonials (real client words):\n' +
      testimonials.map(t => `"${t.text}"${t.name ? ` — ${t.name}${t.role ? ', ' + t.role : ''}` : ''}`).join('\n'));
  }
  const stats = brief?.content?.stats as Array<{value: string; label: string}> | undefined;
  if (stats && stats.length > 0) {
    sacredParts.push('[EXACT] Stats (real numbers):\n' +
      stats.map(s => `${s.value} ${s.label}`).join(' | '));
  }
  const team = brief?.content?.team as Array<{name: string; role?: string; bio?: string}> | undefined;
  if (team && team.length > 0) {
    sacredParts.push('[EXACT] Team members:\n' +
      team.map(m => `- ${m.name}${m.role ? ', ' + m.role : ''}${m.bio ? ': ' + m.bio : ''}`).join('\n'));
  }
  const sacredBlock = sacredParts.join('\n\n');

  // Client design references
  const inspirationUrls = brief?.branding?.inspiration_urls as string[] | undefined;
  const inspirationBlock = inspirationUrls && inspirationUrls.length > 0
    ? inspirationUrls.map(u => `- ${u}`).join('\n') + '\nStudy the aesthetic, typography, and layout patterns of these sites. Absorb the sensibility, not the content.'
    : '';

  // No-photos directive
  const noPhotos = brief?.media?.no_photos === true;
  const noPhotosBlock = noPhotos
    ? `\n## ⚠️ NO PHOTOS — TYPOGRAPHY-ONLY DESIGN\n\nThe client explicitly requested ZERO images. Do NOT use any <img> tags or stock photo URLs (Unsplash, Pexels, or anything else). Build the entire visual experience with typography, color, geometric CSS shapes, borders, gradients, and whitespace. This is a creative challenge — some of the best Awwwards sites are image-free.\n`
    : '';

  return `## Client Brief

${briefJson}
${languageDirective}${noPhotosBlock}
${sacredBlock ? `\n## Sacred Content (use EXACTLY as written)\n\n${sacredBlock}` : ''}
${!noPhotos && assetLines ? `\n## Uploaded Assets\n${assetLines}` : ''}
${creativePlan ? `
## Creative Direction (a creative director designed this experience for this brand)

${creativePlan}

Use this as your creative foundation. The direction, colors, typography, and interactions described above are your starting point — but you may adapt and improve as you code. If something from the plan uses a banned pattern (grain, marquee, cursor mix-blend, etc.), replace it with something original. The goal is the SPIRIT of the plan, not literal copy.
` : ''}

${rawConversation ? `
## Client's Own Words (RAW — use this to understand the brand if the brief JSON is incomplete):

${rawConversation}
` : ''}
Now create. Output the complete HTML file.`;
}

// ─── Extract HTML ────────────────────────────────────────────────────────────

export function extractHtml(response: string): string {
  let html = response.trim();

  // Strip markdown code fences
  html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '');

  // Strip any text before <!DOCTYPE if present
  const doctypeIndex = html.indexOf('<!DOCTYPE');
  const doctypeLower = html.indexOf('<!doctype');
  const startIdx = doctypeIndex !== -1 ? doctypeIndex : doctypeLower;
  if (startIdx > 0) {
    html = html.slice(startIdx);
  }

  // Strip any text after </html>
  const endIdx = html.lastIndexOf('</html>');
  if (endIdx !== -1) {
    html = html.slice(0, endIdx + '</html>'.length);
  }

  return html.trim();
}

// ─── Apply Brief Content (post-generation sacred text replacement) ───────────
// Sonnet writes all copy freely. This step ensures client-provided data
// (exact titles, contact info, testimonials, stats, team) is correct in the final HTML.

export function applyBriefContent(html: string, brief: Record<string, any>): { html: string; fixes: string[] } {
  const fixes: string[] = [];
  let fixed = html;

  // 1. Exact headline — ensure h1 contains the client's exact title
  const exactTitle = brief?.content?.opening_line || brief?.content?.headline;
  if (exactTitle) {
    const cleanTitle = exactTitle.replace(/^\[EXACT\]\s*/i, '').trim();
    const h1Match = fixed.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
    if (h1Match) {
      const currentH1Text = h1Match[1].replace(/<[^>]*>/g, '').trim();
      // Only replace if Sonnet wrote something significantly different
      if (currentH1Text.toLowerCase() !== cleanTitle.toLowerCase() &&
          !currentH1Text.toLowerCase().includes(cleanTitle.toLowerCase())) {
        // Only replace simple text H1s — styled H1s with inner tags (span, em) are intentional
        if (!/<[^>]+>/.test(h1Match[1])) {
          const newH1 = h1Match[0].replace(h1Match[1], cleanTitle);
          fixed = fixed.replace(h1Match[0], newH1);
          fixes.push(`H1 corrected to exact title: "${cleanTitle}"`);
        }
      }
    }
  }

  // 2. Contact email — find any email in HTML and ensure it matches brief
  const briefEmail = brief?.contact?.email;
  if (briefEmail) {
    // Replace any mailto: links and visible email text
    fixed = fixed.replace(/mailto:[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, `mailto:${briefEmail}`);
    // Replace visible email text (in links, paragraphs, etc.)
    fixed = fixed.replace(/>([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})</g, `>${briefEmail}<`);
    fixes.push(`Email ensured: ${briefEmail}`);
  }

  // 3. Contact phone
  const briefPhone = brief?.contact?.phone;
  if (briefPhone) {
    const phoneDigits = briefPhone.replace(/\D/g, '');
    fixed = fixed.replace(/tel:[0-9+\s()-]+/g, `tel:${phoneDigits}`);
    fixes.push(`Phone ensured: ${briefPhone}`);
  }

  // 4. Business name — ensure it appears correctly
  const businessName = brief?.business?.name;
  if (businessName) {
    // Check nav logo text
    const logoMatch = fixed.match(/<a[^>]*class="[^"]*logo[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    if (logoMatch) {
      const logoText = logoMatch[1].replace(/<[^>]*>/g, '').trim();
      if (logoText && !logoText.includes(businessName) && logoText.length < 50) {
        fixed = fixed.replace(logoMatch[1], logoMatch[1].replace(logoText, businessName));
        fixes.push(`Logo text corrected to: ${businessName}`);
      }
    }
  }

  // 5. Social links
  const social = brief?.social ?? {};
  if (social.instagram) {
    const igHandle = social.instagram.replace(/^@/, '');
    fixed = fixed.replace(/instagram\.com\/[a-zA-Z0-9_.]+/g, `instagram.com/${igHandle}`);
  }

  if (fixes.length > 0) {
    console.log(`[applyBriefContent] Applied ${fixes.length} corrections: ${fixes.join(', ')}`);
  }

  return { html: fixed, fixes };
}

// ─── Inject Analytics ────────────────────────────────────────────────────────
// If brief has analytics.ga_id → Google Analytics 4.
// Otherwise → lightweight self-hosted beacon to /api/analytics/:projectId.

export function injectAnalytics(html: string, brief: Record<string, any>, projectId: string): string {
  if (html.includes('gtag(') || html.includes('__grappes_track')) return html;

  const gaId = brief?.analytics?.ga_id;
  let snippet: string;

  if (gaId && /^G-[A-Z0-9]+$/i.test(gaId)) {
    snippet = `
<script async src="https://www.googletagmanager.com/gtag/js?id=${gaId}"></script>
<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments);}gtag('js',new Date());gtag('config','${gaId}');</script>`;
  } else {
    snippet = `
<script>/* __grappes_track */(function(){var p='https://grappes.dev/api/analytics/${projectId}';var d={url:location.href,ref:document.referrer,w:screen.width};navigator.sendBeacon?navigator.sendBeacon(p,JSON.stringify(d)):fetch(p,{method:'POST',body:JSON.stringify(d),keepalive:true}).catch(function(){});})();</script>`;
  }

  const headClose = html.indexOf('</head>');
  if (headClose !== -1) {
    return html.slice(0, headClose) + snippet + '\n' + html.slice(headClose);
  }
  return html;
}

// ─── Inject Backlink ─────────────────────────────────────────────────────────
// Injects adsnow.ro backlink and normalizes copyright year before saving.

export function injectBacklink(html: string): string {
  const currentYear = new Date().getFullYear().toString();

  // Normalize any old copyright year (e.g. © 2024, © 2023) to current year
  let result = html.replace(/©\s*20[0-9]{2}/g, `© ${currentYear}`);

  const backlink = `\n<!-- grappes.dev -->\n<div style="position:fixed;bottom:8px;right:12px;z-index:9999;font-size:11px;opacity:0.55;pointer-events:auto;font-family:sans-serif"><a href="https://grappes.dev" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">by grappes.dev</a></div>`;

  const bodyClose = result.lastIndexOf('</body>');
  if (bodyClose !== -1) {
    return result.slice(0, bodyClose) + backlink + '\n' + result.slice(bodyClose);
  }
  return result + backlink;
}

// ─── Inject Form Handler ─────────────────────────────────────────────────────
// Wires any <form> elements in the generated HTML to the /api/forms/:projectId
// endpoint so contact forms work on deployed sites without custom JS.

export function injectFormHandler(html: string, projectId: string): string {
  if (!html.includes('<form')) return html;

  const script = `
<script>
/* grappes form handler */
(function(){
  document.querySelectorAll('form').forEach(function(form){
    if(form.dataset.adsnowBound) return;
    form.dataset.adsnowBound = '1';
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function(v,k){ data[k]=v; });
      fetch('https://grappes.dev/api/forms/${projectId}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){return r.json();})
        .then(function(res){
          if(res.success){
            var msg = form.querySelector('[data-success]') || form;
            var msgP=document.createElement('p');msgP.style.cssText='color:inherit;padding:12px 0';msgP.textContent=res.message||'Message sent successfully!';msg.innerHTML='';msg.appendChild(msgP);
          }
        })
        .catch(function(){});
    });
  });
})();
</script>`;

  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + script + '\n' + html.slice(bodyClose);
  }
  return html + script;
}

// ─── Inject Missing Effect Runtimes ──────────────────────────────────────────
// If Sonnet used window.__effectName() but didn't include the runtime, inject it.

export function injectEffectRuntimes(html: string): string {
  const missing: string[] = [];

  for (const [fnName, runtime] of Object.entries(ALL_RUNTIMES)) {
    // Check if the HTML calls this effect (e.g. window.__textType or __textType)
    if (html.includes(fnName) && !html.includes(runtime.slice(0, 60))) {
      missing.push(runtime);
    }
  }

  if (missing.length === 0) return html;

  // Inject before </body>
  const injection = `\n<script>\n/* ── Injected Effect Runtimes ── */\n${missing.join('\n')}\n</script>`;
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + injection + '\n' + html.slice(bodyClose);
  }

  // Fallback: append before </html>
  const htmlClose = html.lastIndexOf('</html>');
  if (htmlClose !== -1) {
    return html.slice(0, htmlClose) + injection + '\n' + html.slice(htmlClose);
  }

  return html + injection;
}

// ─── Opus Creative Plan (the brain — thinks, doesn't code) ──────────────────

async function generateCreativePlan(brief: BriefData, locale: string, rawConversation?: string): Promise<{ plan: string; inputTokens: number; outputTokens: number }> {
  const briefJson = JSON.stringify(brief, null, 2);
  const businessName = brief?.business?.name || 'Brand';
  const industry = brief?.business?.industry || '';
  const description = brief?.business?.description || '';
  const style = brief?.branding?.style || '';
  const complexity = brief?.preferences?.complexity || 'complete';
  const noPhotos = brief?.media?.no_photos === true;
  const langNames: Record<string, string> = { ro: 'Romanian', en: 'English', fr: 'French', de: 'German', es: 'Spanish' };
  const lang = langNames[locale] || 'English';

  try {
    const response = await createMessage({
      model: OPUS_MODEL,
      max_tokens: 4000,
      system: `You are the world's best creative director for digital experiences. You've won 50+ Awwwards SOTD. You study locomotive.ca, obys.agency, synchrodogs.com obsessively. You don't build websites — you direct experiences.

Your job: write a DETAILED creative plan for a website. You do NOT write code. You write a blueprint so specific that any skilled developer could build it exactly as you envision.

Your plan must include:

1. THE SOUL — Who is this brand? Not what they do — who they ARE. Sensory, emotional, 2-3 sentences.

2. THE CONCEPT — One visceral metaphor that drives every design choice. Unique to THIS brand.

3. THE EXPERIENCE — Describe the visitor's journey moment by moment. Be physically specific about sizes, positions, colors, movements. But INVENT something new every time — never reuse ideas from previous plans.

4. THE INTERACTIONS — Describe 2-3 specific animations. Each must be UNIQUE to this brand — something that only makes sense for THIS business. Never default to: grain/noise canvas, mix-blend-mode cursor, diagonal wipe, text-stroke outlines. These are overused. Invent fresh interactions.

5. THE TYPOGRAPHY — Font choices with reasoning. Scale relationships. Specify exact clamp() values.

6. THE COLOR — Hex codes. Where each appears. How color shifts through the scroll journey.

7. THE LAYOUT CHOREOGRAPHY — How sections transition into each other. Not "fade in" — describe the spatial relationship. Does content overlap? Do images bleed into the next section? Is there a horizontal scroll moment? Does the grid break intentionally?

## Your creative vocabulary (techniques to draw from — pick what serves the brand)

You know these techniques exist. Use them as ingredients, not as a checklist:
- Scroll-driven reveals: clip-path morphing, scale transitions, parallax layers at different speeds (scrub: true)
- Text as architecture: split text with per-character stagger, text that reveals on scroll, oversized type as background texture, text clipping over images
- Image as experience: full-viewport images with scroll-driven zoom, image sequences, reveal masks (circular wipe, diagonal clip, scale-from-center), images that parallax against text
- Spatial depth: z-index layering where text floats over images over backgrounds, elements that move at different scroll speeds creating depth
- Rhythm breakers: one section that breaks the vertical flow — horizontal scroll, a fullscreen takeover, a canvas moment, an unexpected layout shift
- Micro-interactions: hover states that transform elements meaningfully (not just color change), cursor-aware elements, click reveals
- Transition zones: the space BETWEEN sections is design — overlapping elements, gradient bleeds, shared visual elements that bridge sections

Pre-built effects available to the developer (use only if one genuinely fits):
- __textPressure: characters respond to mouse proximity with font weight changes (variable fonts)
- __curvedLoop: text on a Bézier curve, loops as marquee
- __scrollStack: cards stack on scroll with scale/rotate/blur
- __flowingMenu: full-width menu items with marquee overlay on hover
- __invertCorners: elements with concave clip-path corners

Rules:
- Think in MOMENTS and TRANSITIONS, not in sections
- Every choice must serve THIS specific brand
- For every interaction you describe, ask: "Could this exist on any other website?" If yes, it's not creative enough. Every animation must be BORN from the brand's identity — not applied on top of it.
- A honey brand might have golden viscous drips. A blacksmith might have sparks that follow the cursor. A transport platform might have routes drawing themselves. The interaction IS the brand.
- Be specific enough that there is zero ambiguity — describe exact CSS properties, exact GSAP parameters, exact scroll positions where things happen
- Write in English`,
      messages: [{
        role: 'user',
        content: `Create the creative plan for:

"${businessName}" — ${industry}
${description}
Style: ${style || 'surprise me — make it unforgettable'}
Complexity: ${complexity}
Language: ${lang}
${noPhotos ? 'NO PHOTOGRAPHS. Zero <img> tags. Build the entire visual experience with typography, CSS shapes, canvas, color, and whitespace. Some of the best Awwwards sites are image-free.' : 'Only the client-uploaded assets are available — no stock photo services. Use each uploaded image as a PRIMARY visual medium (full-bleed, edge-to-edge, overlapping, as backgrounds — never decoration in boxes). For sections without an uploaded image, design with typography, CSS shapes, color, and whitespace instead of stock placeholders.'}

Full brief:
${briefJson}

MANDATORY — include these two things in your plan:

1. THE IMPOSSIBLE MOMENT: Describe ONE technical interaction that makes visitors think "how did they do that?" Something bespoke to THIS brand — a canvas animation, a physics simulation, a scroll-driven transformation, a cursor effect that changes the page. Not a generic GSAP fade. Something a developer would screenshot and share.

2. IMAGES AS EXPERIENCE (if photos allowed): Every image must be full-bleed, edge-to-edge, or overlapping with text. NEVER an image inside a box/card. Specify exact CSS: "background-size: cover; mix-blend-mode: multiply" or "position: absolute; width: 120vw; clip-path: polygon(...)". Images ARE the page, not decoration ON the page.

Write the complete creative plan. Be detailed. Be specific. Be brilliant.
${rawConversation ? `

## RAW CLIENT CONVERSATION (this is what the client actually said — use this as your PRIMARY source of truth):

${rawConversation}` : ''}`
      }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    const inputTokens = response.usage?.input_tokens ?? 0;
    const outputTokens = response.usage?.output_tokens ?? 0;
    console.log(`[opus-plan] Generated for ${businessName}: ${raw.length} chars, ${inputTokens}+${outputTokens} tokens`);
    return { plan: raw.trim(), inputTokens, outputTokens };
  } catch (e) {
    console.error('[opus-plan] FAILED — site will generate without creative direction:', e);
    return { plan: '', inputTokens: 0, outputTokens: 0 };
  }
}

// ─── Main Generation Function ────────────────────────────────────────────────

export async function generateSite(params: {
  projectId: string;
  brief: BriefData;
  assets: AssetData[];
  locale?: string;
  rawConversation?: string;
}): Promise<{ html: string; cost: number; tokens: { input: number; output: number }; opusPlanFailed: boolean }> {
  const { projectId, brief, assets, locale, rawConversation } = params;

  // Step 0: Opus Creative Plan — the brain thinks, Sonnet executes
  const opusPlan = await generateCreativePlan(brief, locale || 'en', rawConversation);
  const opusPlanFailed = !opusPlan.plan;
  const opusCost = opusPlan.inputTokens * OPUS_INPUT_COST + opusPlan.outputTokens * OPUS_OUTPUT_COST;
  console.log(`[creative-generation] Opus plan cost: $${opusCost.toFixed(3)}${opusPlanFailed ? ' (FAILED — generating without creative direction)' : ''}`);

  const userPrompt = buildUserPrompt(brief, assets, opusPlan.plan, rawConversation);

  console.log(`[creative-generation] Generating site for project ${projectId}`);
  console.log(`[creative-generation] Brief size: ${JSON.stringify(brief).length} chars`);
  console.log(`[creative-generation] Assets: ${assets.length}`);

  // Single Sonnet call — 64K output is enough for a full site
  const MAX_TOKENS = 64000;
  const MAX_CONTINUATIONS = 3;

  let totalInputTokens = 0;
  let totalOutputTokens = 0;
  let combinedHtml = '';

  const response = await createMessage({
    model: SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    system: CREATIVE_SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const firstRaw = response.content[0]?.type === 'text' ? response.content[0].text : '';
  totalInputTokens += response.usage?.input_tokens ?? 0;
  totalOutputTokens += response.usage?.output_tokens ?? 0;
  combinedHtml = firstRaw;

  // Continuation if truncated
  for (let i = 0; i < MAX_CONTINUATIONS; i++) {
    const extracted = extractHtml(combinedHtml);
    if (extracted.includes('</html>')) {
      combinedHtml = extracted;
      break;
    }

    console.log(`[creative-generation] Truncated after ${combinedHtml.length} chars — continuation ${i + 1}/${MAX_CONTINUATIONS}`);

    const contResponse = await createMessage({
      model: SONNET_MODEL,
      max_tokens: MAX_TOKENS,
      system: CREATIVE_SYSTEM_PROMPT,
      messages: [
        { role: 'user', content: userPrompt },
        { role: 'assistant', content: combinedHtml },
        { role: 'user', content: 'Continue EXACTLY where you left off. Do not repeat any HTML already written. Complete the remaining sections and close all tags through </html>.' },
      ],
    });

    const contRaw = contResponse.content[0]?.type === 'text' ? contResponse.content[0].text : '';
    totalInputTokens += contResponse.usage?.input_tokens ?? 0;
    totalOutputTokens += contResponse.usage?.output_tokens ?? 0;
    combinedHtml += contRaw.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  }

  const html = extractHtml(combinedHtml);

  if (!html.includes('</html>')) {
    throw new Error(`HTML incomplete after ${MAX_CONTINUATIONS} continuations (${html.length} chars) — generation failed`);
  }

  console.log(`[creative-generation] Complete: ${html.length} chars, ${totalOutputTokens} output tokens`);

  const cost = totalInputTokens * SONNET_INPUT_COST + totalOutputTokens * SONNET_OUTPUT_COST + opusCost;

  return {
    html,
    cost,
    tokens: { input: totalInputTokens, output: totalOutputTokens },
    opusPlanFailed,
  };
}

// ─── Grammar Check (kept from html-generation.ts, uses Haiku) ────────────────

export async function grammarCheckHtml(params: {
  html: string;
  locale: string;
}): Promise<{ html: string; inputTokens: number; outputTokens: number; corrections: number }> {
  const { html, locale } = params;

  const langNames: Record<string, string> = {
    ro: 'Romanian', en: 'English', fr: 'French', de: 'German',
    es: 'Spanish', it: 'Italian', pt: 'Portuguese', nl: 'Dutch',
  };
  const langLabel = langNames[locale] || locale;

  // Strip <style> and <script> blocks so grammar check doesn't touch CSS/JS
  const strippedHtml = html
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<script[\s\S]*?<\/script>/gi, '');

  // Extract visible text from HTML
  const textSegments: string[] = [];
  const textRegex = />([^<]{4,})</g;
  let match;
  while ((match = textRegex.exec(strippedHtml)) !== null) {
    const text = match[1].trim();
    if (text.length > 3 && !/^[{}\[\]()0-9.,;:!?@#$%^&*+=<>/'"\-\s]+$/.test(text)) {
      textSegments.push(text);
    }
  }

  if (textSegments.length === 0) {
    return { html, inputTokens: 0, outputTokens: 0, corrections: 0 };
  }

  const response = await createMessage({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    system: `You are a ${langLabel} language proofreader. You receive text segments extracted from a website and return ONLY the corrections needed. Output a JSON array of objects: [{"from":"incorrect text","to":"corrected text"}]. If no corrections needed, output []. Rules:
- Fix spelling, diacritics, grammar, and punctuation errors
- Fix incorrect ${langLabel} word forms, agreements, prepositions
- Do NOT change meaning, style, or sentence structure
- Do NOT translate — keep the original language
- Only include segments that actually need correction
- Output ONLY the JSON array, nothing else`,
    messages: [{
      role: 'user',
      content: `Check these ${langLabel} text segments for errors:\n\n${textSegments.map((t, i) => `${i + 1}. "${t}"`).join('\n')}`,
    }],
  });

  const raw = response.content[0]?.type === 'text' ? response.content[0].text : '[]';
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();

  let corrections: Array<{ from: string; to: string }> = [];
  try {
    corrections = JSON.parse(cleaned);
  } catch {
    return { html, inputTokens: response.usage?.input_tokens ?? 0, outputTokens: response.usage?.output_tokens ?? 0, corrections: 0 };
  }

  let fixedHtml = html;
  for (const c of corrections) {
    if (c.from && c.to && c.from !== c.to) {
      fixedHtml = fixedHtml.replace(/>([^<]+)</g, (match, textContent) => {
        if (textContent.includes(c.from)) {
          return '>' + textContent.split(c.from).join(c.to) + '<';
        }
        return match;
      });
    }
  }

  return {
    html: fixedHtml,
    inputTokens: response.usage?.input_tokens ?? 0,
    outputTokens: response.usage?.output_tokens ?? 0,
    corrections: corrections.length,
  };
}
