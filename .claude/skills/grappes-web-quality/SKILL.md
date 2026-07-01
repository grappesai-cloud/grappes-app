---
name: grappes-web-quality
description: House rules for building/delivering client websites in grappes-app (concierge flow). Vanilla single-file HTML stack, hard QA guardrails that prevent the broken-output bugs we have actually hit, and the delivery/verify workflow. Use alongside the frontend-design skill whenever building or editing a client site.
---

# Grappes — Web Quality & Delivery

Pair this with the `frontend-design` skill. That skill decides *what* looks good; this one keeps it *working* and tells you how to ship it. Build distinctive (per frontend-design), then pass every guardrail below before delivering.

## Stack (non-negotiable)
- Output is ONE self-contained `.html` file: inline `<style>` + inline `<script>`, vanilla HTML/CSS/JS. NO build step, NO React/Tailwind/Next, NO external JS bundles except well-known CDNs (and only if truly needed).
- Romanian copy by default when the brief is RO. NEVER use em-dashes (—) in user-facing copy; use comma / period / colon / · instead.
- Use the client's real assets (logo + photos) by their R2 URLs from `GET /api/admin/projects/[id]/brief` (the `assets` array). Work with what the client uploaded; do not invent fake product photos.

## Hard guardrails (these are bugs we actually shipped — never again)
1. **NEVER emit `srcset`.** We store exactly ONE size per asset. AI-invented responsive variants 404, and browsers prefer a srcset candidate over `src`, so the image renders broken (notably the hero → "blank on desktop"). Use a plain `<img src>` only. Always set `width`/`height` (avoid CLS) and `loading="lazy"` for below-the-fold images, `object-fit:cover`.
2. **Reveal animations are progressive enhancement.** Content must be fully visible WITHOUT JS. Gate the hidden state behind a `.js` class: `.js .reveal{opacity:0;...}` / `.js .reveal.in{opacity:1}`, and add `document.documentElement.classList.add('js')` at script start. Use IntersectionObserver with a **safety-net** `setTimeout(revealAll, 4000)` so nothing can stay invisible if the observer never fires. Honor `prefers-reduced-motion`.
3. **Animation: use the real stack, loaded correctly.** Awwwards-grade motion needs GSAP + ScrollTrigger + Lenis (smooth scroll), NOT vanilla IntersectionObserver (that reads as mediocre). Load all three from CDN (cdn.jsdelivr.net is allowed by the preview CSP) and **always `gsap.registerPlugin(ScrollTrigger)`** before using it — referencing `ScrollTrigger`/`scrollTrigger:` without loading the plugin is exactly what broke the first AI site. Progressive-enhancement contract: set hidden states in JS via `gsap.set(...)` ONLY after confirming `window.gsap && window.ScrollTrigger` (so content is visible if a CDN fails); honor `prefers-reduced-motion` (skip Lenis + animations). Wrap Lenis init in try/catch AFTER the GSAP animations so a Lenis load failure can't kill the visible motion. Add a `setTimeout` safety that forces any still-hidden `.rv` to opacity:1. The motion toolkit that lands: hero word/line mask reveal (wrap words in `.w{overflow:hidden} > i{display:inline-block}`, animate `yPercent:118 -> 0` staggered), scroll-scrubbed atmosphere (e.g. a day->night sky + a setting sun via one ScrollTrigger `scrub`), per-image parallax, section `gsap.from` reveals on ScrollTrigger, magnetic buttons (mousemove → gsap.to x/y, mouseleave → elastic back), a seamless gsap ticker marquee. Less is more on COUNT, but the few you pick must be smooth and orchestrated.
4. **CSS specificity / the container bug.** A full-bleed wrapper with `width:100%` will override a `.wrap{width:min(1240px,90vw);margin:0 auto}` container (later same-specificity rule wins) → content goes flush to the edge. Keep the container intact; give full-bleed elements their own class that does NOT also set width on the constrained content. Watch element-vs-class selectors cancelling section padding.
5. **Unify mismatched photos.** Client photos vary in tone. Apply ONE consistent grade (e.g. `filter:saturate(1.04) contrast(1.04) brightness(.97)`) and/or a consistent gradient overlay so the set reads as one brand, not a collage.
6. **Hero text legibility.** Over a photo, put a directional gradient behind the text side (e.g. darker on the left for left-aligned copy) so the headline is readable on any image.

## Avoid the AI defaults (see frontend-design)
Do NOT default to: cream `#F4F1EA` + Fraunces serif + terracotta accent; or near-black + acid-green/vermilion; or broadsheet hairlines + `01/02/03` numbered markers. We have shipped exactly that and the client called it "ordinary." Numbered markers only if the content is a real ordered sequence. Derive palette + type from the subject's world.

## Verify before delivering (always)
Render the live preview headless, scroll through it, and screenshot desktop + mobile. Confirm: 0 console/page errors, 0 broken images (`naturalWidth>0` after scroll), 0 `.reveal` elements stuck at `opacity:0`, hero content properly inset (not flush to edge), responsive holds at 390px. A picture is worth 1000 tokens — look at it before claiming it's done. (Helper pattern: puppeteer from the project dir, fetch `/preview/[id]?token=<share>`; or use the chrome-devtools / playwright MCP if available.)

## Deliver
`POST /api/admin/projects/[id]/deliver` with headers `x-admin-secret: <ADMIN_SECRET>`, `Content-Type: text/html`, `Origin: https://grappes.dev`, body = the HTML file (`curl --data-binary @site.html`). Add `?notify=0` to store WITHOUT emailing the client (use while iterating); drop it for the final hand-off so the client gets the "site ready" email. The endpoint strips any srcset as a backstop and flips the project to `generated` with a working `/preview`.

## Share token (to view a delivered preview without the owner session)
`token = HMAC-SHA256(SHARE_TOKEN_SECRET, "share:"+projectId).slice(0,24)` → `GET /preview/[id]?token=...`.
