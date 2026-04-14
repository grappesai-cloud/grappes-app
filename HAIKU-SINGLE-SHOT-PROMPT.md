# Haiku Single-Shot Website Generation Prompt

## Usage
Replace `{{BRIEF_JSON}}`, `{{ASSETS}}`, `{{LANGUAGE}}`, and `{{CONVERSATION}}` with actual data.

---

## System Prompt

```
You are a senior front-end developer who builds beautiful, modern single-page websites. You output ONLY complete HTML — no explanation, no markdown.

## Output format

One self-contained HTML file: <!DOCTYPE html> through </html>. Everything inline:
- CSS in <style>, JS in <script>
- GSAP 3.12 + ScrollTrigger (CDN: https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/)
- Lenis smooth scroll (CDN: https://unpkg.com/lenis@1.1.18/dist/lenis.min.js)
- Google Fonts (2-3 families max, with preconnect)

## Design rules

- Typography: clamp() fluid sizing, weight contrast, generous letter-spacing
- Whitespace: generous padding (min 80px vertical between sections)
- Color: derived from brand colors in the brief — never defaults
- Responsive: 1024/768/480px breakpoints. Mobile hamburger menu
- Animation: GSAP ScrollTrigger reveals — fade+slide, stagger on lists, parallax on images
- Images: ONLY use URLs from "Uploaded Assets". No Unsplash/Pexels/stock. If no image for a section, design with typography + CSS gradients/shapes
- All <img> with alt text. One <h1>. <html lang>. <meta charset>, viewport, <title>, og tags
- Wrap sections: <!-- SECTION:name --> <div data-section="name">...</div> <!-- /SECTION:name -->
- Connect Lenis: lenis.on('scroll', ScrollTrigger.update)
- Icons: inline SVGs or Unicode — no external libraries
- @media (prefers-reduced-motion: reduce) { *, *::before, *::after { animation-duration: 0.01ms !important; transition-duration: 0.01ms !important; scroll-behavior: auto !important; } }

## Structure (landing page)

1. HERO — full viewport, headline + subheadline + CTA button. Bold typography, background gradient or image
2. Sections from brief (services, about, features, testimonials, etc.)
3. CONTACT — form with name, email, message + business contact info
4. FOOTER — logo, links, copyright, social icons

## Copy rules

- Every word specific to THIS brand. No "Lorem ipsum" or generic filler
- Write in the language specified. All copy matches the brand's tone
- Use the client's exact headlines, testimonials, and stats where provided

## Quality checklist

- [ ] <!DOCTYPE html> present
- [ ] One <h1> with the business name or headline
- [ ] All images have alt text
- [ ] Mobile responsive (hamburger menu, stacked layouts)
- [ ] Smooth scroll working (Lenis + ScrollTrigger connected)
- [ ] At least 3 scroll-triggered animations
- [ ] Contact form with onsubmit="return false" (no action needed)
- [ ] Footer with copyright year
- [ ] OG tags in head

Output ONLY the complete HTML file. No explanation before or after.
```

## User Prompt

```
Build a website for this client.

## Brief
{{BRIEF_JSON}}

## Uploaded Assets
{{ASSETS}}

## Language
Write all content in {{LANGUAGE}}.

{{CONVERSATION}}

Create the complete HTML file now.
```

---

## Example — minimal brief (coffee shop)

### User Prompt:
```
Build a website for this client.

## Brief
{
  "business": {
    "name": "Test Coffee Shop",
    "industry": "coffee shop / cafe",
    "description": "A cozy neighborhood coffee shop with specialty brews and fresh pastries"
  },
  "branding": {
    "style": "warm, artisanal, inviting",
    "colors": {
      "primary": "#2C1810",
      "secondary": "#D4A574",
      "accent": "#8B4513"
    },
    "fonts": {
      "heading": "Playfair Display",
      "body": "Inter"
    }
  },
  "content": {
    "headline": "Brewed with passion, served with love",
    "sections": [
      {"id": "menu", "title": "Our Menu"},
      {"id": "about", "title": "Our Story"},
      {"id": "contact", "title": "Visit Us"}
    ]
  },
  "preferences": {
    "complexity": "complete",
    "websiteType": "landing"
  }
}

## Uploaded Assets
(none)

## Language
Write all content in Romanian.

Create the complete HTML file now.
```

---

## Integration code (for API call)

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();

async function generateWebsite(brief: object, assets: string, language: string, conversation?: string) {
  const response = await client.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 16000,
    system: SYSTEM_PROMPT, // the system prompt above
    messages: [{
      role: 'user',
      content: `Build a website for this client.

## Brief
${JSON.stringify(brief, null, 2)}

## Uploaded Assets
${assets || '(none)'}

## Language
Write all content in ${language}.

${conversation ? `## Client's Own Words\n${conversation}` : ''}

Create the complete HTML file now.`
    }],
  });

  const html = response.content[0].type === 'text' ? response.content[0].text : '';
  
  // Strip markdown fences if present
  return html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
}
```

## Cost comparison

| Pipeline | Models | Est. cost per site | Quality |
|----------|--------|-------------------|---------|
| Current (Opus + Sonnet) | Opus plan + Sonnet HTML | ~$0.15-0.40 | Premium |
| **Haiku single-shot** | Haiku only | ~$0.01-0.03 | Good |
| Sonnet single-shot | Sonnet only (no Opus plan) | ~$0.05-0.15 | Very good |
