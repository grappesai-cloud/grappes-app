// A/B: base xhigh vs base + SIGNATURE EFFECTS COOKBOOK, on dj + saas.
// Same plan per brief; only difference = the appended effects cookbook + mandate.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
for (const line of readFileSync('.env', 'utf8').split('\n')) { const m = line.match(/^([^#=]+)=(.*)$/); if (m) process.env[m[1].trim()] = m[2].trim().replace(/^["']|["']$/g, ''); }
const { createMessage } = await import('../src/lib/anthropic.ts');
const { buildUserPrompt, extractHtml, CREATIVE_SYSTEM_PROMPT } = await import('../src/lib/creative-generation.ts');
const puppeteer = (await import('puppeteer' as string)).default;
const OUT = 'scripts/_abfx_out';
import { mkdirSync } from 'node:fs'; mkdirSync(OUT, { recursive: true });
const messageText = (r: any) => Array.isArray(r?.content) ? (r.content.find((x: any) => x?.type === 'text' && typeof x.text === 'string')?.text ?? '') : '';

const COOKBOOK = `

## SIGNATURE EFFECTS COOKBOOK — compose 1 to 2 that embody THIS brand's metaphor
You MUST build at least ONE bespoke signature moment, drawn from or inspired by this cookbook, tied to the brand's physical metaphor, placed in the hero or one key section. ADAPT it to the concept (color, motion, scale, shape); do not paste verbatim and do not use more than two. A site without a signature moment is a failure.

GUARDRAILS (override the goal above): all hard constraints still apply — NO scroll-driven motion (effects fire on load/hover/click/intersection/timer only), native scroll, WCAG AA, one h1, the hero keeps its headline + CTA above the fold, @media (prefers-reduced-motion: reduce) gives a calm static fallback for every effect. GSAP 3.12 core is loaded. Size any <canvas> with the buffer = rendered size × devicePixelRatio pattern.

1. CURSOR-REACTIVE CANVAS FIELD (hero bg): a field of points/lines/particles, tinted to the brand, that drifts continuously and repels or attracts around the cursor. (DJ: pulsing frequency lines; restaurant: rippling water/caustics; SaaS: slow drifting motes settling.)
2. MAGNETIC CURSOR + ELEMENTS: a custom cursor element that lerps toward the mouse (gsap.quickTo); [data-magnetic] buttons/links pull toward the cursor on hover and snap back on leave.
3. SPLIT-TEXT STAGGER REVEAL (hero headline): split into words/chars, GSAP stagger in from opacity:0 + yPercent:100 (or clip-path / rotation), on load and via IntersectionObserver for sections. Never a plain fade.
4. CLIP-PATH REVEAL MASK (sections/images, IO one-shot): animate clip-path from a concept-shaped start (inset(100% 0 0 0), circle(0%), diagonal polygon) to fully revealed when the section enters the viewport.
5. 3D TILT ON HOVER (cards / feature tiles / images): perspective on the parent, rotateX/rotateY toward the cursor on mousemove, smooth reset on leave.
6. TEXT SCRAMBLE / DECODE (eyebrows or one key word, on IO): cycle random glyphs that resolve char-by-char into the final string. (Strong for techno, tech, editorial.)
7. ANIMATED AURORA / GRADIENT (full-bleed bg): a slow continuous canvas or CSS @property gradient loop in the brand palette (independent of scrollY).

Pick what the brand would actually feel like, build it well, and make it the thing a visitor screenshots.`;

const BRIEFS: Record<string, any> = {
  dj: { business: { name: 'NOKTA', industry: 'dj', entity_type: 'person', description: 'A Bucharest techno DJ and producer, dark melodic sets, resident at a warehouse club.', tagline: 'Sound in the dark', locale: 'en' }, target_audience: { primary: 'Promoters, clubbers, and labels' }, content: { copy_ownership: 'generate', headline: '', sections: [ { id: 'music', title: 'Music' }, { id: 'events', title: 'Events' }, { id: 'about', title: 'About' }, { id: 'contact', title: 'Booking' } ] }, branding: { colors: { primary: '#0A0A0A', secondary: '#F2F2F2', accent: '#7B2FF7' }, fonts: { heading: 'Space Grotesk', body: 'Inter' }, voice: { traits: ['dark', 'minimal', 'hypnotic'] }, style: 'dark cinematic minimal' }, contact: { email: 'booking@nokta.live' }, media: { audio_embeds: ['https://open.spotify.com/artist/4dpARuHxo51G3z768sgnrY', 'https://soundcloud.com/nokta'] }, features: { contact_form: true }, preferences: { primary_goal: 'listen', websiteType: 'landing', complexity: 'complete' } },
  saas: { business: { name: 'Driftwood', industry: 'saas', entity_type: 'organization', description: 'A focus app that turns your scattered browser tabs into one calm reading queue, synced across devices.', tagline: 'Calm your tabs', locale: 'en' }, target_audience: { primary: 'Knowledge workers and students drowning in open tabs' }, content: { copy_ownership: 'generate', headline: '', sections: [ { id: 'features', title: 'Features' }, { id: 'pricing', title: 'Pricing' }, { id: 'about', title: 'About' }, { id: 'contact', title: 'Contact' } ], pricing_mode: 'tiered', pricing_items: [ { name: 'Free', price: '$0', note: 'up to 50 saves' }, { name: 'Pro', price: '$6/mo', note: 'unlimited + sync' } ] }, branding: { colors: { primary: '#1B4332', secondary: '#F7F4EF', accent: '#E07A5F' }, fonts: { heading: 'Clash Display', body: 'Inter' }, voice: { traits: ['calm', 'precise', 'friendly'] }, style: 'calm editorial product' }, contact: { email: 'hello@driftwood.app' }, features: { contact_form: true }, preferences: { primary_goal: 'subscribe', websiteType: 'landing', complexity: 'complete' } },
};

const SCROLL_JS = `new Promise(res => { let y = 0; const step = () => { window.scrollTo(0, y); y += 500; if (y < document.body.scrollHeight + 1000) setTimeout(step, 70); else { window.scrollTo(0, 0); setTimeout(res, 500); } }; step(); })`;
const REVEAL_JS = `document.querySelectorAll('body *').forEach(function(el){ var s = getComputedStyle(el); if (parseFloat(s.opacity) === 0) el.style.setProperty('opacity','1','important'); if (s.visibility === 'hidden') el.style.setProperty('visibility','visible','important'); if (s.transform !== 'none' && /matrix|translate|scale/.test(s.transform)) el.style.setProperty('transform','none','important'); })`;
const FREEZE_JS = `(function(){ var st=document.createElement('style'); st.textContent='*,*::before,*::after{animation:none !important;transition:none !important}'; document.head.appendChild(st); window.requestAnimationFrame=function(){return 0}; })()`;
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'], protocolTimeout: 600000 });
async function shoot(base: string, html: string) {
  for (const vp of [{ l: 'desktop', w: 1440, h: 900 }, { l: 'mobile', w: 390, h: 844 }]) {
    try { const page = await browser.newPage(); await page.setViewport({ width: vp.w, height: vp.h, deviceScaleFactor: 1 });
      await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30000 }).catch(() => {}); await new Promise(r => setTimeout(r, 1500));
      await page.evaluate(SCROLL_JS).catch(() => {}); await page.evaluate(REVEAL_JS).catch(() => {}); await page.evaluate(FREEZE_JS).catch(() => {});
      await new Promise(r => setTimeout(r, 400)); await page.screenshot({ path: `${OUT}/${base}__${vp.l}.png`, fullPage: true, timeout: 120000 }); await page.close();
    } catch (e: any) { console.warn(`  (shot ${base} ${vp.l} failed: ${e?.message ?? e})`); }
  }
}
async function gen(label: string, system: string, brief: any, userPrompt: string) {
  if (existsSync(`${OUT}/${label}.html`)) { await shoot(label, readFileSync(`${OUT}/${label}.html`, 'utf8')); return; }
  const t0 = Date.now();
  const res = await createMessage({ model: 'claude-opus-4-8', max_tokens: 128000, thinking: { type: 'adaptive' }, output_config: { effort: 'xhigh' }, system, messages: [{ role: 'user', content: userPrompt }] } as any);
  const html = extractHtml(messageText(res));
  writeFileSync(`${OUT}/${label}.html`, html);
  console.log(`✓ ${label}: ${html.length} chars, stop=${(res as any).stop_reason}, ${res.usage?.output_tokens ?? 0} tok, ${((Date.now() - t0) / 1000).toFixed(0)}s`);
  await shoot(label, html);
}
for (const key of ['dj', 'saas']) {
  // Skip the Opus creative plan (its generator is no longer exported). Both arms
  // get the same (empty) plan, so the only variable is the effects cookbook.
  const userPrompt = buildUserPrompt(BRIEFS[key], [], '');
  await gen(`${key}__base`, CREATIVE_SYSTEM_PROMPT, BRIEFS[key], userPrompt);
  await gen(`${key}__fx`, CREATIVE_SYSTEM_PROMPT + COOKBOOK, BRIEFS[key], userPrompt);
}
await browser.close();
console.log('DONE abfx');
