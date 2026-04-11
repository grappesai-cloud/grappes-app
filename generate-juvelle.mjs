import Anthropic from '@anthropic-ai/sdk';
import { readFileSync, writeFileSync } from 'fs';
import { readFileSync as readEnv } from 'fs';
// Load .env manually
const envContent = readEnv('.env', 'utf8');
for (const line of envContent.split('\n')) {
  const match = line.match(/^([^#=]+)=(.*)$/);
  if (match) process.env[match[1].trim()] = match[2].trim();
}

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
  timeout: 600_000,
});

// Same system prompt as creative-generation.ts
const SYSTEM_PROMPT = readFileSync(new URL('./src/lib/creative-generation.ts', import.meta.url), 'utf8')
  .match(/export const CREATIVE_SYSTEM_PROMPT = `([\s\S]*?)`;/)?.[1] || '';

const brief = {
  business: {
    name: "Juvelle",
    industry: "camera & photography equipment",
    description: "Juvelle is a premium camera brand crafting mirrorless and analog cameras for photographers who see photography as art, not just documentation. Each Juvelle camera is designed with obsessive attention to ergonomics, optical precision, and timeless aesthetics. Think Leica meets modern minimalism.",
    tagline: "See what others miss."
  },
  target_audience: {
    primary: "Professional photographers and passionate enthusiasts who value craftsmanship, precision optics, and design beauty in their tools",
    demographics: "25-55, high income, urban creatives, art directors, editorial photographers"
  },
  content: {
    headline: "See what others miss.",
    about: "Founded by photographers, for photographers. Juvelle cameras are precision instruments designed to disappear in your hands — so all that remains is you and the moment. Every body is machined from aerospace-grade aluminum, every lens element hand-polished. We don't chase megapixels. We chase feeling.",
    tagline: "Precision. Craft. Vision.",
    sections: [
      { id: "hero", title: "Hero" },
      { id: "cameras", title: "Our Cameras" },
      { id: "philosophy", title: "Philosophy" },
      { id: "gallery", title: "Shot on Juvelle" },
      { id: "specs", title: "Specifications" },
      { id: "contact", title: "Contact" }
    ],
    services: ["Juvelle M1 — Mirrorless Full Frame", "Juvelle A35 — Analog 35mm", "Juvelle Lenses — Prime Collection", "Juvelle Studio — Custom Builds"]
  },
  branding: {
    style: "minimal",
    colors: {
      primary: "#1a1a1a",
      secondary: "#f5f0eb",
      accent: "#c4a265"
    },
    fonts: {
      heading: "Instrument Serif",
      body: "Inter"
    }
  },
  media: {
    has_logo: false,
    hero_style: "photo"
  },
  features: {
    contact_form: true,
    newsletter: true,
    ecommerce: false
  },
  preferences: {
    websiteType: "landing",
    animations: "rich",
    performance_priority: false
  },
  meta: {
    title: "Juvelle — Precision Camera Craft",
    description: "Handcrafted mirrorless and analog cameras for photographers who see photography as art. Precision optics, timeless design, aerospace-grade build."
  },
  contact: {
    email: "hello@juvelle.com"
  },
  social: {
    instagram: "https://instagram.com/juvelle",
  }
};

const references = `- Leica (leica-camera.com) — notice the reverence for craft, photography-first design
- Hasselblad (hasselblad.com) — notice the product hero treatment, dark backgrounds, precision feel
- Bang & Olufsen (bang-olufsen.com) — notice the luxury product presentation, minimal UI, tactile quality`;

const userPrompt = `## Client Brief

${JSON.stringify(brief, null, 2)}

## Creative References

Study the aesthetic direction of these references — don't copy, absorb the vibe:

${references}

## Fresh Direction

This is a fresh start. No constraints. Follow your instinct for this brand. Make it feel like holding a precision instrument — cold aluminum, smooth aperture ring, the satisfying click of a shutter. The website should feel as crafted as the cameras.

Now create. Output the complete HTML file.`;

console.log('Generating Juvelle website with Claude Sonnet...');
console.log(`Brief size: ${JSON.stringify(brief).length} chars`);

const startTime = Date.now();

// Use Claude CLI (Claude Code subscription) instead of API
import { execSync, spawn } from 'child_process';

const fullPrompt = SYSTEM_PROMPT + '\n\n---\n\n' + userPrompt;
const claudePath = '/Users/alexandrucojanu/.local/bin/claude';

console.log('Using Claude CLI (Claude Code subscription)...');
console.log(`Prompt size: ~${Math.round(fullPrompt.length / 4)} estimated tokens`);

// Write prompt to temp file and use execSync with pipe
const tmpFile = '/tmp/juvelle-prompt.txt';
writeFileSync(tmpFile, fullPrompt);
console.log(`Prompt saved (${fullPrompt.length} chars), calling Claude CLI...`);

const cleanEnv = { ...process.env, HOME: '/Users/alexandrucojanu' };
delete cleanEnv.ANTHROPIC_API_KEY;

const result = execSync(
  `cat "${tmpFile}" | "${claudePath}" -p --model sonnet --output-format text`,
  { env: cleanEnv, maxBuffer: 50 * 1024 * 1024, timeout: 600_000 }
).toString();

let html = result.trim();
html = html.replace(/^```(?:html)?\s*/i, '').replace(/\s*```\s*$/, '');
const doctypeIndex = html.indexOf('<!DOCTYPE') !== -1 ? html.indexOf('<!DOCTYPE') : html.indexOf('<!doctype');
if (doctypeIndex > 0) html = html.slice(doctypeIndex);
const endIdx = html.lastIndexOf('</html>');
if (endIdx !== -1) html = html.slice(0, endIdx + '</html>'.length);

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
console.log(`\nDone in ${elapsed}s`);
console.log(`HTML size: ${html.length} chars`);

const outPath = '/Users/alexandrucojanu/Desktop/juvelle.html';
writeFileSync(outPath, html);
console.log(`Saved to: ${outPath}`);
console.log('Opening in browser...');

execSync(`open "${outPath}"`);
