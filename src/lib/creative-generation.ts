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

## Images — NEVER CROP USER-UPLOADED PHOTOS

User-provided photos (logos, hero images, portfolio, team, gallery, any asset URL we hand you) MUST be displayed whole. The user picked a specific framing and we do not override it.

- Default to \`object-fit: contain\` on every <img>. NEVER use \`object-fit: cover\` on user assets.
- For hero sections: make the image container adapt to the image's aspect-ratio (use CSS \`aspect-ratio\`, \`height: auto\`, or flex layout) instead of forcing a fixed 16:9 frame that crops the photo.
- Logos: always \`object-fit: contain\` with generous padding. Never clip.
- Do NOT use \`background-image\` with \`background-size: cover\` on user assets — that crops by default. If you must use background-image, use \`background-size: contain\` and \`background-position: center\` with a matching \`aspect-ratio\`.
- Galleries and grids: let cards grow to the photo's natural ratio (masonry / flex wrap) rather than squeezing every photo into a uniform square that crops it.
- The ONE exception: purely decorative full-bleed background patterns we generate ourselves (gradients, abstract textures) — those may cover. But anything the USER uploaded is sacred framing — show it all.

## Complexity

essential = tight, few moments. complete = rich journey. showcase = epic experience. Default: complete.

## BANNED PATTERNS — instant quality failure

These patterns appear on every template site. Using them = generic output.

Layout bans:
- Three equal-width cards in a row for features/services — use staggered, timeline, accordion, horizontal scroll, overlapping, or full-width blocks instead
- Hero: centered text with semi-transparent dark overlay on image — the #1 template cliché. Use split layouts, asymmetric type, text-as-architecture, or image-as-full-bleed instead
- Uniform grid of identical team/portfolio cards — use masonry, varied sizes, or editorial layouts
- Footer with 3-4 equal columns of links — make it minimal or integrate it into the experience

Animation bans:
- fadeIn from bottom as the ONLY scroll animation — pair with scale, clip-path, rotation, or position shift
- All elements animating identically — stagger timing, vary easing, make each reveal unique
- Generic hover: scale(1.05) + box-shadow — create hover states that relate to the content

Visual bans:
- Dark gradient overlays on hero images for text readability — use text-shadow, knockout text, separate text area, or blend modes
- Gray placeholder boxes or "Image goes here" — design without images using typography and color
- Icon + title + paragraph card repeated 3-6 times — find a unique layout for each service/feature

Think: "What would a creative agency with a $50K budget design?" Not three cards in a row.

## Critical

- Output ONLY the complete HTML. No explanation.
- Every word of copy: specific to THIS brand. No generic text.
- Be bold. Make something that stops the scroll.`;

// ─── Reference Pool ──────────────────────────────────────────────────────────

// Reference pool and freshness notes removed — Sonnet knows Awwwards sites
// from training and produces more diverse results without hardcoded references
// that anchor it to the same 12 sites every time.

// Creative seed, art direction, and brand narrative replaced by Opus Creative Plan

// ─── Creative Anchors (diversity system) ────────────────────────────────
// Each generation picks a random style anchor so sites don't converge
// on the same patterns. Opus incorporates the anchor into its creative plan.

const CREATIVE_ANCHORS = [
  { name: 'Brutalist Typography', directive: 'Oversized type (120px+) as architectural elements. Raw, confrontational layouts. Heavy sans-serifs. Content bleeds edge-to-edge. Visible grid lines. Anti-decoration.' },
  { name: 'Editorial Magazine', directive: 'Think Kinfolk/Cereal magazine. Extreme whitespace. Serif headlines with wide letter-spacing. Asymmetric photo-text compositions. Pull quotes as design anchors. Elegant restraint.' },
  { name: 'Cinematic Scroll', directive: 'Full-viewport sections. Each scroll position is a scene change. Dramatic scale transitions. Parallax at 3+ depth layers. Letterbox framing. Slow, deliberate reveals.' },
  { name: 'Swiss Precision', directive: 'Strict grid. Helvetica or geometric sans. Mathematical spacing ratios. Monochrome + one accent color. Clean, authoritative, timeless. Information hierarchy through scale alone.' },
  { name: 'Organic Flow', directive: 'No straight lines or sharp corners. Border-radius everywhere. Blob shapes as dividers. Gentle wave animations. Colors shift like a sunset as you scroll. Soft, alive, natural.' },
  { name: 'Deconstructed Grid', directive: 'Break the grid intentionally. Overlapping elements. Text running off-screen. Images at unexpected angles. Controlled chaos that still reads clearly.' },
  { name: 'Monochrome Luxury', directive: 'Pure black and white (or one deep color + white). No gradients. Contrast through scale — whisper-small labels next to billboard headlines. Extreme restraint = extreme sophistication.' },
  { name: 'Dimensional Layers', directive: 'Z-axis depth: background texture layer, middle content layer, foreground floating elements. Scroll reveals layers at different speeds. Sticky elements create parallax depth.' },
  { name: 'Type as Image', directive: 'Typography IS the visual. Oversized letters as backgrounds. Text clipped to reveal images. Character-level scroll animations. Variable font weight responding to scroll. Words ARE the design.' },
  { name: 'Horizontal Journey', directive: 'At least one section uses horizontal scroll. Content moves left-to-right like a timeline or film strip. Vertical sections bookend the horizontal moment. Memorable rhythm break.' },
];

function pickCreativeAnchor(): { name: string; directive: string } {
  return CREATIVE_ANCHORS[Math.floor(Math.random() * CREATIVE_ANCHORS.length)];
}

function generateCreativeSeed(brief: BriefData): string {
  const anchor = pickCreativeAnchor();
  const businessName = brief?.business?.name || 'the brand';
  const industry = brief?.business?.industry || 'business';
  return `## Creative Direction (auto-generated — Opus was unavailable)

**Style anchor: ${anchor.name}**
${anchor.directive}

Apply this aesthetic to "${businessName}" (${industry}). Every interaction must be unique to this specific brand — the style anchor is your starting point, not your constraint. Think in MOMENTS, not sections. Create one "impossible moment" that makes developers ask "how did they do that?" Content flows — elements overlap, images bleed, text floats.`;
}

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

  // Build asset lines for the prompt.
  // Split into BRAND assets (logo, og — always included even in no-photos mode)
  // and PHOTO assets (hero, section, menu — suppressed when no_photos is true).
  let brandAssetLines = '';
  let photoAssetLines = '';
  for (const asset of assets) {
    if (asset.type === 'logo' && asset.url) {
      brandAssetLines += `\nLOGO IMAGE: ${asset.url} — use as <img> in nav and footer`;
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
          photoAssetLines += `\nHERO IMAGE: ${asset.url}`;
          photoAssetLines += `\n  Responsive srcset: ${srcset}`;
          photoAssetLines += `\n  For hero (LCP): add fetchpriority="high", remove loading="lazy"`;
        } else {
          photoAssetLines += `\nHERO IMAGE: ${asset.url} — use as hero background or <img>`;
        }
      } else {
        photoAssetLines += `\nHERO IMAGE: ${asset.url} — use as hero background or <img>`;
      }
    }
    if (asset.type === 'section' && asset.url && asset.sectionId) {
      photoAssetLines += `\nSECTION IMAGE (${asset.sectionId}): ${asset.url}`;
    }
    if (asset.type === 'menu' && asset.url) {
      photoAssetLines += `\nMENU PHOTO: ${asset.url} — reference only, menu data already extracted as content.menu in the brief`;
    }
    if (asset.type === 'og' && asset.url) {
      brandAssetLines += `\nOG IMAGE: ${asset.url} — use for og:image meta tag`;
    }
  }
  let assetLines = brandAssetLines + photoAssetLines;

  // Video embed instruction (treated as a brand asset — kept even in no-photos mode)
  const videoUrl = brief?.media?.videoUrl;
  const videoMode = brief?.media?.videoPlayMode || 'click';
  if (videoUrl) {
    const videoBlock = `\n\nVIDEO: ${videoUrl}
Play mode: ${videoMode === 'autoplay' ? 'autoplay when 50% visible in viewport' : 'click-to-play (show thumbnail + play button)'}
Embed as an iframe or video element with explicit dimensions (width:100%;aspect-ratio:16/9).`;
    brandAssetLines += videoBlock;
    assetLines += videoBlock;
  }

  // Menu data (data, not a photo — kept even in no-photos mode)
  if (brief?.content?.menu?.categories?.length > 0) {
    const menuBlock = `\n\nMENU DATA: The brief contains content.menu with structured menu categories and items (extracted from a photo). Render this as a beautifully styled menu section — not a plain list. Think editorial restaurant menu: clean typography, category headers, item names with prices, subtle separators. This is real data from the client's actual menu.`;
    brandAssetLines += menuBlock;
    assetLines += menuBlock;
  } else if (brief?.content?.menu_raw) {
    const menuRawBlock = `\n\nMENU DATA (raw text): The brief contains content.menu_raw with menu items extracted from a photo. Parse this text and render it as a styled menu section with categories, items, and prices.`;
    brandAssetLines += menuRawBlock;
    assetLines += menuRawBlock;
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
  const collaborators = brief?.content?.collaborators as Array<{name: string; role?: string; brand?: string}> | undefined;
  if (collaborators && collaborators.length > 0) {
    sacredParts.push('[EXACT] Collaborators (featured artists, producers, directors, guest performers — render in a dedicated "Credits" or "Collaborators" section, NOT as team):\n' +
      collaborators.map(c => `- ${c.name}${c.role ? ', ' + c.role : ''}${c.brand ? ' (' + c.brand + ')' : ''}`).join('\n'));
  }
  const pressMentions = brief?.content?.press_mentions as Array<{name: string; url?: string; year?: string}> | undefined;
  if (pressMentions && pressMentions.length > 0) {
    sacredParts.push('[EXACT] Press mentions (render as a "Press" or "Featured in" section — horizontal logo row or typographic list):\n' +
      pressMentions.map(p => `- ${p.name}${p.year ? ' (' + p.year + ')' : ''}${p.url ? ' — ' + p.url : ''}`).join('\n'));
  }
  const awards = brief?.content?.awards as Array<{name: string; year?: string; issuer?: string}> | undefined;
  if (awards && awards.length > 0) {
    sacredParts.push('[EXACT] Awards & recognition:\n' +
      awards.map(a => `- ${a.name}${a.issuer ? ' (' + a.issuer + ')' : ''}${a.year ? ' — ' + a.year : ''}`).join('\n'));
  }
  const sacredBlock = sacredParts.join('\n\n');

  // Brand voice + entity type — influences copy tone
  const voiceTraits = brief?.branding?.voice?.traits as string[] | undefined;
  const voiceAvoid = brief?.branding?.voice?.avoid as string[] | undefined;
  const voiceFormality = brief?.branding?.voice?.formality as string | undefined;
  const entityType = brief?.business?.entity_type as string | undefined;
  const voiceParts: string[] = [];
  if (voiceTraits && voiceTraits.length > 0) voiceParts.push(`Voice traits: ${voiceTraits.join(', ')}`);
  if (voiceAvoid && voiceAvoid.length > 0) voiceParts.push(`MUST NOT sound: ${voiceAvoid.join(', ')}`);
  if (voiceFormality) voiceParts.push(`Formality: ${voiceFormality}`);
  if (entityType === 'person') {
    voiceParts.push(`Entity: personal brand — use first-person ("I", "my") voice for bio/about. Write as the person themselves, not about them.`);
  } else if (entityType === 'organization') {
    voiceParts.push(`Entity: organization — use "we/our" or third-person voice. Talk as the company/team.`);
  }
  const voiceBlock = voiceParts.length > 0 ? voiceParts.join('\n') : '';

  // Copy ownership — who writes the content
  const copyOwnership = brief?.content?.copy_ownership as string | undefined;
  let copyBlock = '';
  if (copyOwnership === 'user') {
    copyBlock = `Copy approach: CLIENT-PROVIDED. The client will supply all copy. For sections without sacred content, write clear structural placeholders: "[Your service description here]", "[Client testimonial]". Do NOT write polished marketing copy for empty sections — write minimal placeholder text that signals the client needs to fill it in.`;
  } else if (copyOwnership === 'hybrid') {
    copyBlock = `Copy approach: HYBRID. Write polished hero headlines, CTAs, and short section intros. For detailed service descriptions, bios, case studies, and testimonials, use structural placeholders like "[Describe your process here]" unless the client provided that content in the brief.`;
  }

  // Primary goal — drives hero CTA
  const primaryGoal = brief?.preferences?.primary_goal as string | undefined;
  const goalBlock = primaryGoal ? `Primary conversion: "${primaryGoal}". The hero CTA and subsequent CTAs must funnel toward this action. Make the primary CTA visually dominant (size, color, motion). Suggested CTA copy:
- "book" → "Book a session" / "Reserve your spot"
- "listen" → "Listen now" / "Stream on Spotify"
- "inquire" → "Start a conversation" / "Request a quote"
- "buy" → "Shop now" / "Get yours"
- "subscribe" → "Join the list" / "Subscribe"
- "contact" → "Get in touch"
- "download" → "Download now"` : '';

  // Pricing rendering directive
  const pricingMode = brief?.content?.pricing_mode as string | undefined;
  const pricingItems = brief?.content?.pricing_items as Array<{name: string; price: string; note?: string}> | undefined;
  let pricingBlock = '';
  if (pricingMode === 'inquire') {
    pricingBlock = `Pricing: "inquire only" — do NOT display specific numbers. Add a section with CTA like "Inquire for rates" → contact form. Common for high-end/luxury creative brands.`;
  } else if (pricingMode === 'list' && pricingItems && pricingItems.length > 0) {
    pricingBlock = `Pricing (LIST mode — editorial typography, NEVER SaaS checkmark table):
${pricingItems.map(p => `- ${p.name}: ${p.price}${p.note ? ' (' + p.note + ')' : ''}`).join('\n')}

Render as a typographic list: large service name, price aligned right or below, minimal separators. Think editorial magazine pricing, not tech pricing card with checkmarks.`;
  } else if (pricingMode === 'tiered' && pricingItems && pricingItems.length > 0) {
    pricingBlock = `Pricing (TIERED packages — 2-3 distinct tiers, each gets its own card but use THIS brand's visual language, NOT generic SaaS green-checkmark):
${pricingItems.map(p => `- ${p.name}: ${p.price}${p.note ? ' (' + p.note + ')' : ''}`).join('\n')}`;
  }

  // Audio embeds — musicians, bands, DJs, podcasters
  const audioEmbeds = brief?.media?.audio_embeds as string[] | undefined;
  let audioBlock = '';
  if (audioEmbeds && audioEmbeds.length > 0) {
    audioBlock = `Audio embeds — render a dedicated "Music" / "Listen" section with iframes for each platform. Do NOT hide in a sidebar — make it a HEADLINE moment.
URLs:
${audioEmbeds.map(u => `- ${u}`).join('\n')}

Embed patterns:
- Spotify artist/track URL (open.spotify.com/artist/ID or /track/ID) → convert to https://open.spotify.com/embed/artist/ID or /embed/track/ID, iframe height 380
- YouTube (youtu.be/ID or youtube.com/watch?v=ID) → <iframe src="https://www.youtube.com/embed/ID" allowfullscreen>, aspect-ratio 16/9
- SoundCloud track URL → <iframe src="https://w.soundcloud.com/player/?url=ENCODED_URL&color=%23ff5500&auto_play=false" width="100%" height="166">
- Apple Music (music.apple.com/...) → <iframe src="https://embed.music.apple.com/..." height="450" allow="autoplay *; encrypted-media *">

Style the section immersively: large, full-bleed or edge-to-edge, typography-heavy intro ("Listen.", "Now Playing.", etc).`;
  }

  // Hero video flag (separate from media.videoUrl which is an actual asset)
  const heroVideoFlag = brief?.media?.hero_video === true;
  const heroVideoBlock = heroVideoFlag && !videoUrl
    ? `Hero video intent: client wants a cinematic/motion-driven hero. If no video asset is uploaded, build the hero with dramatic motion — large animated typography, CSS/canvas motion, scroll-driven transforms. Convey "video-like" energy with code.`
    : '';

  // Integration hints — so Sonnet doesn't hardcode booking iframes we inject later
  const bookingProvider = brief?.integrations?.booking as string | undefined;
  const bookingNote = (bookingProvider && bookingProvider !== 'none')
    ? `Booking integration: post-processing will bind ${bookingProvider === 'calcom' ? 'Cal.com' : 'Calendly'} popup to buttons. For the primary CTA targeting "${primaryGoal || 'book'}", render a plain <a href="#book" data-book="true" class="..."> button. Do NOT embed a booking iframe yourself.`
    : '';


  // Combine creative context into one block
  const creativeContextParts = [
    voiceBlock && `### Brand Voice\n${voiceBlock}`,
    copyBlock && `### Copy Approach\n${copyBlock}`,
    goalBlock && `### Conversion Goal\n${goalBlock}`,
    pricingBlock && `### Pricing Section\n${pricingBlock}`,
    audioBlock && `### Audio / Music Section\n${audioBlock}`,
    heroVideoBlock && `### Hero Video\n${heroVideoBlock}`,
    bookingNote && `### Booking Widget\n${bookingNote}`,
  ].filter(Boolean);
  const creativeContextBlock = creativeContextParts.length > 0
    ? `\n## Creative Context (brand-specific rendering rules)\n\n${creativeContextParts.join('\n\n')}\n`
    : '';

  // Client design references
  const inspirationUrls = brief?.branding?.inspiration_urls as string[] | undefined;
  const inspirationBlock = inspirationUrls && inspirationUrls.length > 0
    ? inspirationUrls.map(u => `- ${u}`).join('\n') + '\nStudy the aesthetic, typography, and layout patterns of these sites. Absorb the sensibility, not the content.'
    : '';

  // No-photos directive. Brand assets (logo, OG image, video) are STILL allowed —
  // "no photos" means no editorial photography (hero, section images, gallery), not
  // zero brand identity.
  const noPhotos = brief?.media?.no_photos === true;
  const noPhotosBlock = noPhotos
    ? `\n## ⚠️ NO EDITORIAL PHOTOS — TYPOGRAPHY-FOCUSED DESIGN\n\nThe client requested no editorial photography (no hero photos, no section photos, no gallery). Do NOT use any photographic <img> for sections, heroes, galleries, or backgrounds. Stock photo URLs (Unsplash, Pexels, etc.) are forbidden.\n\nBUT — uploaded brand assets ARE allowed and SHOULD be used:\n- Logo (in nav and footer) — required if uploaded\n- OG image (for social sharing meta tag) — required if uploaded\n- Video (if uploaded) — embed as specified\n\nFor sections without an uploaded brand asset, build the visual experience with typography, color, geometric CSS shapes, borders, gradients, and whitespace.\n`
    : '';

  return `## Client Brief

${briefJson}
${languageDirective}${noPhotosBlock}
${sacredBlock ? `\n## Sacred Content (use EXACTLY as written)\n\n${sacredBlock}` : ''}
${creativeContextBlock}
${assetLines ? `\n## Uploaded Assets\n${noPhotos ? brandAssetLines : assetLines}` : ''}
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
// Reads brief.integrations.analytics ("ga" | "plausible" | "fathom" | "none").
// Fallback order: explicit provider → legacy analytics.ga_id → self-hosted beacon.
// "none" disables tracking entirely (explicit user opt-out).

export function injectAnalytics(html: string, brief: Record<string, any>, projectId: string): string {
  if (html.includes('gtag(') || html.includes('__grappes_track') || html.includes('plausible.io/js/') || html.includes('cdn.usefathom.com')) return html;

  const provider = brief?.integrations?.analytics as string | undefined;
  if (provider === 'none') return html; // explicit opt-out

  const gaId = brief?.analytics?.ga_id || brief?.integrations?.analytics_id;
  const plausibleDomain = brief?.integrations?.plausible_domain || brief?.project?.domain;
  const fathomSiteId = brief?.integrations?.analytics_id;

  let snippet: string;

  if (provider === 'plausible' && plausibleDomain) {
    snippet = `\n<script defer data-domain="${plausibleDomain}" src="https://plausible.io/js/script.js"></script>`;
  } else if (provider === 'fathom' && fathomSiteId) {
    snippet = `\n<script src="https://cdn.usefathom.com/script.js" data-site="${fathomSiteId}" defer></script>`;
  } else if ((provider === 'ga' || !provider) && gaId && /^G-[A-Z0-9]+$/i.test(gaId)) {
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

// ─── Inject Booking Widget ──────────────────────────────────────────────────
// Reads brief.integrations.booking ("calcom" | "calendly") + booking_url.
// Binds any element with data-book="true" to the provider's popup.

export function injectBookingWidget(html: string, brief: Record<string, any>): string {
  const provider = brief?.integrations?.booking as string | undefined;
  const bookingUrl = brief?.integrations?.booking_url as string | undefined;
  if (!provider || provider === 'none' || !bookingUrl) return html;

  let snippet = '';
  if (provider === 'calcom') {
    const calLink = bookingUrl.replace(/^https?:\/\/(app\.)?cal\.com\//, '').replace(/^\/+/, '').replace(/\/+$/, '');
    snippet = `
<script>
(function(){
  var s=document.createElement('script');
  s.src='https://app.cal.com/embed/embed.js';
  s.async=true;
  s.onload=function(){
    if(!window.Cal) return;
    window.Cal('init','grappes',{origin:'https://cal.com'});
    document.querySelectorAll('[data-book]').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        window.Cal.ns.grappes('modal',{calLink:'${calLink}'});
      });
    });
  };
  document.head.appendChild(s);
})();
</script>`;
  } else if (provider === 'calendly') {
    snippet = `
<link rel="stylesheet" href="https://assets.calendly.com/assets/external/widget.css">
<script>
(function(){
  var u=${JSON.stringify(bookingUrl)};
  var s=document.createElement('script');
  s.src='https://assets.calendly.com/assets/external/widget.js';
  s.async=true;
  s.onload=function(){
    document.querySelectorAll('[data-book]').forEach(function(btn){
      btn.addEventListener('click',function(e){
        e.preventDefault();
        if(window.Calendly) window.Calendly.initPopupWidget({url:u});
      });
    });
  };
  document.head.appendChild(s);
})();
</script>`;
  }

  if (!snippet) return html;
  const bodyClose = html.lastIndexOf('</body>');
  if (bodyClose !== -1) {
    return html.slice(0, bodyClose) + snippet + '\n' + html.slice(bodyClose);
  }
  return html + snippet;
}

// ─── Inject Backlink ─────────────────────────────────────────────────────────
// Injects adsnow.ro backlink and normalizes copyright year before saving.

export function injectBacklink(html: string, opts?: { brandingRemoved?: boolean }): string {
  const currentYear = new Date().getFullYear().toString();

  // Normalize any old copyright year (e.g. © 2024, © 2023) to current year
  let result = html.replace(/©\s*20[0-9]{2}/g, `© ${currentYear}`);

  // Skip the badge for projects that paid to remove branding.
  if (opts?.brandingRemoved) return result;

  const backlink = `\n<!-- grappes.dev -->\n<div style="position:fixed;bottom:8px;right:12px;z-index:9999;font-size:11px;opacity:0.55;pointer-events:auto;font-family:sans-serif"><a href="https://grappes.dev" target="_blank" rel="noopener" style="color:inherit;text-decoration:none">by grappes.dev</a></div>`;

  const bodyClose = result.lastIndexOf('</body>');
  if (bodyClose !== -1) {
    return result.slice(0, bodyClose) + backlink + '\n' + result.slice(bodyClose);
  }
  return result + backlink;
}

// Strip the injected grappes.dev backlink in-place from any HTML that already had it.
// Used by the webhook after a successful "remove branding" purchase to clean up
// already-deployed HTML before re-deploying it.
export function stripGrappesBacklink(html: string): string {
  return html
    .replace(/\n?<!-- grappes\.dev -->\n?<div[^>]*>\s*<a[^>]*href="https:\/\/grappes\.dev"[^>]*>[^<]*<\/a>\s*<\/div>/g, '')
    // Defensive cleanup if the comment was lost but the styled div remains.
    .replace(/<div[^>]*z-index:9999[^>]*>\s*<a[^>]*href="https:\/\/grappes\.dev"[^>]*>by grappes\.dev<\/a>\s*<\/div>/g, '');
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
    // Inject a hidden honeypot field — bots fill every field; real users leave it blank
    if(!form.querySelector('input[name="_hp"]')){
      var hp=document.createElement('input');
      hp.type='text';hp.name='_hp';hp.tabIndex=-1;hp.autocomplete='off';
      hp.style.cssText='position:absolute;left:-9999px;width:1px;height:1px;opacity:0;pointer-events:none;';
      hp.setAttribute('aria-hidden','true');
      form.appendChild(hp);
    }
    form.addEventListener('submit', function(e){
      e.preventDefault();
      var data = {};
      new FormData(form).forEach(function(v,k){ data[k]=v; });
      // Infer type from form attribute or field names
      if(!data.type){
        if(form.dataset.formType) data.type = form.dataset.formType;
        else if(Object.keys(data).length===1 && data.email) data.type='newsletter';
        else data.type='contact';
      }
      var btn = form.querySelector('button[type="submit"], input[type="submit"]');
      var origLabel = btn ? (btn.textContent || btn.value) : '';
      if(btn){ btn.disabled=true; if(btn.textContent!==undefined) btn.textContent='Sending…'; else btn.value='Sending…'; }
      fetch('https://grappes.dev/api/forms/${projectId}',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)})
        .then(function(r){return r.json().then(function(j){return {ok:r.ok,body:j};});})
        .then(function(res){
          if(res.ok && res.body.success){
            var msg = form.querySelector('[data-success]') || form;
            var msgP=document.createElement('p');msgP.style.cssText='color:inherit;padding:12px 0';msgP.textContent=res.body.message||'Message sent successfully!';msg.innerHTML='';msg.appendChild(msgP);
          } else {
            if(btn){ btn.disabled=false; if(btn.textContent!==undefined) btn.textContent=origLabel; else btn.value=origLabel; }
            var errEl=form.querySelector('[data-error]');
            if(errEl) errEl.textContent = (res.body && res.body.error) || 'Could not send. Please try again.';
            else alert((res.body && res.body.error) || 'Could not send. Please try again.');
          }
        })
        .catch(function(){
          if(btn){ btn.disabled=false; if(btn.textContent!==undefined) btn.textContent=origLabel; else btn.value=origLabel; }
        });
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
  const entityType = brief?.business?.entity_type as string | undefined;
  const primaryGoal = brief?.preferences?.primary_goal as string | undefined;
  const voiceTraits = (brief?.branding?.voice?.traits as string[] | undefined)?.join(', ');
  const voiceAvoid = (brief?.branding?.voice?.avoid as string[] | undefined)?.join(', ');
  const voiceFormality = brief?.branding?.voice?.formality as string | undefined;
  const audioEmbeds = brief?.media?.audio_embeds as string[] | undefined;
  const collaborators = brief?.content?.collaborators as Array<{name: string; role?: string}> | undefined;
  const pressMentions = brief?.content?.press_mentions as Array<{name: string}> | undefined;
  const awards = brief?.content?.awards as Array<{name: string}> | undefined;
  const pricingMode = brief?.content?.pricing_mode as string | undefined;
  const langNames: Record<string, string> = { ro: 'Romanian', en: 'English', fr: 'French', de: 'German', es: 'Spanish' };
  const lang = langNames[locale] || 'English';
  const anchor = pickCreativeAnchor();

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
${entityType ? `Entity: ${entityType === 'person' ? 'personal brand (first-person "I" voice for bio)' : 'organization (we/team voice)'}` : ''}
${primaryGoal ? `Primary conversion goal: "${primaryGoal}" — the hero and journey must funnel visitors toward this action.` : ''}
${voiceTraits ? `Brand voice traits: ${voiceTraits}` : ''}
${voiceAvoid ? `Voice must NOT sound like: ${voiceAvoid}` : ''}
${voiceFormality ? `Voice formality level: ${voiceFormality}` : ''}
${collaborators && collaborators.length > 0 ? `Collaborators/Credits: ${collaborators.map(c => c.name + (c.role ? ' (' + c.role + ')' : '')).join(', ')} — design a dedicated "Credits" or "Collaborators" section for these people.` : ''}
${pressMentions && pressMentions.length > 0 ? `Press coverage: ${pressMentions.map(p => p.name).join(', ')} — design a "Featured in" or "Press" section (logo row or typographic strip).` : ''}
${awards && awards.length > 0 ? `Awards: ${awards.map(a => a.name).join(', ')} — integrate as social proof into the experience.` : ''}
${audioEmbeds && audioEmbeds.length > 0 ? `Music embeds available (${audioEmbeds.length} streaming URLs) — design a dedicated, immersive "Listen" section around them.` : ''}
${pricingMode && pricingMode !== 'none' ? `Pricing display: ${pricingMode === 'inquire' ? '"inquire only" — no numbers shown, contact-first' : pricingMode === 'list' ? 'editorial list (NOT SaaS table)' : 'tiered packages with brand-specific visual language'}.` : ''}
${noPhotos ? 'NO PHOTOGRAPHS. Zero <img> tags. Build the entire visual experience with typography, CSS shapes, canvas, color, and whitespace. Some of the best Awwwards sites are image-free.' : 'Only the client-uploaded assets are available — no stock photo services. Use each uploaded image as a PRIMARY visual medium (full-bleed, edge-to-edge, overlapping, as backgrounds — never decoration in boxes). For sections without an uploaded image, design with typography, CSS shapes, color, and whitespace instead of stock placeholders.'}

Full brief:
${briefJson}

Creative style anchor (starting point — adapt and evolve it for this brand):
${anchor.name} — ${anchor.directive}

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
  } catch (firstErr: any) {
    console.error('[opus-plan] Attempt 1/2 failed:', firstErr?.message || firstErr);
    await new Promise(r => setTimeout(r, 2000));
    try {
      console.log('[opus-plan] Retrying...');
      const r2 = await createMessage({
        model: OPUS_MODEL,
        max_tokens: 4000,
        system: 'You are an elite creative director for immersive digital experiences. Write a DETAILED creative plan: concept, signature interactions (unique to THIS brand — no grain/noise, no mix-blend-mode cursor, no diagonal wipe, no text-stroke outlines), typography with exact clamp() values, color hex codes, layout choreography describing how sections transition. Think in moments and transitions, not sections. Be specific enough for a developer to build exactly your vision. Write in English.',
        messages: [{ role: 'user', content: `Creative plan for "${businessName}" — ${industry}.\n${description}\nStyle: ${style || 'surprise me — make it unforgettable'}. Complexity: ${complexity}. Language: ${lang}.\n${entityType ? 'Entity: ' + (entityType === 'person' ? 'personal brand (first-person voice)' : 'organization (we/team voice)') : ''}\n${primaryGoal ? 'Primary goal: ' + primaryGoal : ''}\n${voiceTraits ? 'Voice: ' + voiceTraits : ''}\nCreative anchor: ${anchor.name} — ${anchor.directive}\n\nFull brief:\n${briefJson}${rawConversation ? '\n\nClient words:\n' + rawConversation : ''}` }],
      });
      const raw = r2.content[0]?.type === 'text' ? r2.content[0].text : '';
      console.log(`[opus-plan] Retry succeeded for ${businessName}: ${raw.length} chars`);
      return { plan: raw.trim(), inputTokens: r2.usage?.input_tokens ?? 0, outputTokens: r2.usage?.output_tokens ?? 0 };
    } catch (retryErr: any) {
      console.error('[opus-plan] Attempt 2/2 failed:', retryErr?.message || retryErr);
    }
    console.warn('[opus-plan] Both attempts failed — using randomized creative seed');
    return { plan: generateCreativeSeed(brief), inputTokens: 0, outputTokens: 0 };
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
