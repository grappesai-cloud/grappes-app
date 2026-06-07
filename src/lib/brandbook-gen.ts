// ── Brand Book Lab: AI copy generation ────────────────────────────────────────
// One-shot Claude call that turns the wizard answers into every paragraph the
// brand-guidelines document needs. The layout is fixed (brandbook-template.ts);
// this module only produces the words.

import { createMessage } from './anthropic';
import type { WebsiteContext } from './website-context';

export const BRANDBOOK_MODEL = 'claude-sonnet-4-6';

export interface BrandBookInput {
  name: string;
  about: string;            // what the brand does, in the founder's words
  industry?: string;
  values?: string[];        // up to 4 picked/typed value names (optional — AI fills)
  voiceKeywords?: string[]; // up to 4 tone-of-voice adjectives (optional — AI fills)
  colors: Array<{ hex: string; label?: string }>; // 1-4 brand colors beyond black/white
  typeface: string;         // Google Font family name
  logoUrl: string;          // Vercel Blob URL (transparent PNG or SVG)
  website?: WebsiteContext | null; // scraped site copy, optional grounding
}

export interface BrandBookContent {
  tagline: string;
  intro: [string, string];
  about_statement: string;       // one long display sentence, "About the brand — ..."
  aim_statement: string;         // "Our aim is to ..."
  vision_statement: string;      // "Our vision is to ..."
  values: Array<{ title: string; description: string }>;   // exactly 4
  tone: Array<{ title: string; description: string }>;     // exactly 4
  logomark: [string, string];    // two paragraphs about the mark
  logotype: [string, string];    // two paragraphs about the wordmark/typeface as logo
  lockup: string;
  clear_space: string;
  minimum_sizes: string;
  color_intro: string;
  combinations: string;
  typeface_intro: string;
  closing: string;               // short closing line for the last page
}

function buildPrompt(input: BrandBookInput): string {
  const colorList = input.colors.map((c) => c.hex + (c.label ? ` (${c.label})` : '')).join(', ') || 'black & white only';
  return `You are a senior brand strategist writing the copy for a premium brand guidelines document (a "brand book"), in the editorial style of Swiss/international typographic design manuals: confident, concise, declarative, zero fluff, no marketing clichés.

BRAND FACTS:
- Name: ${input.name}
- What it does (founder's words): ${input.about}
${input.industry ? `- Industry: ${input.industry}` : ''}
${input.values?.length ? `- Brand values picked by the founder (use these as the 4 value titles, polish wording if needed): ${input.values.join(', ')}` : '- Brand values: not provided — derive 4 fitting values yourself.'}
${input.voiceKeywords?.length ? `- Tone-of-voice keywords picked by the founder (use as the 4 tone titles): ${input.voiceKeywords.join(', ')}` : '- Tone of voice: not provided — derive 4 fitting tone adjectives yourself.'}
- Brand colors: ${colorList}
- Typeface: ${input.typeface}
${input.website ? `
WEBSITE CONTEXT (scraped from ${input.website.url} — this is the brand's real public copy; ground the book in it, reuse its vocabulary, services, and claims, but never invent facts that contradict the founder's words above):
- Page title: ${input.website.title || 'n/a'}
- Meta description: ${input.website.description || 'n/a'}
- Visible copy excerpt: ${input.website.text}` : ''}

WRITING RULES:
- Language: English.
- Never use em dashes (—) or en dashes (–) inside any value EXCEPT where a field's format explicitly shows one.
- Descriptions are 1-3 sentences, specific to THIS brand, never generic filler.
- Statements ("about_statement", "aim_statement", "vision_statement") are single flowing display sentences of 15-28 words.
- Do not mention "guidelines document" inside values/tone/logo copy.

Return ONLY a JSON object, no markdown fences, with exactly these fields:
{
  "tagline": "4-8 word brand tagline",
  "intro": ["welcome paragraph (~55 words) introducing this brand guidelines document for ${input.name}", "second paragraph (~55 words) on why consistency matters for this brand"],
  "about_statement": "About the brand — ${input.name} is ... (complete the sentence, total 15-28 words)",
  "aim_statement": "Our aim is to ... (15-25 words)",
  "vision_statement": "Our vision is to ... (15-25 words)",
  "values": [{ "title": "...", "description": "..." }, ...exactly 4],
  "tone": [{ "title": "...", "description": "..." }, ...exactly 4],
  "logomark": ["paragraph describing the logomark and what it embodies for the brand (~40 words)", "paragraph on what the design symbolizes (~40 words)"],
  "logotype": ["paragraph on ${input.typeface} as the logotype and why it fits the brand (~50 words)", "paragraph on its versatility across platforms and materials (~35 words)"],
  "lockup": "paragraph on the combination of logomark and logotype (~40 words)",
  "clear_space": "paragraph on respecting clear space around the logo (~35 words)",
  "minimum_sizes": "paragraph mandating a minimum height of 0.75 inch for print and 50px for digital (~35 words)",
  "color_intro": "paragraph on the role of this exact palette for the brand (~40 words)",
  "combinations": "paragraph on consistent use of the approved color combinations (~35 words)",
  "typeface_intro": "paragraph on ${input.typeface} ensuring consistency and legibility across platforms (~35 words)",
  "closing": "one short confident closing line for the final page"
}`;
}

function stripFences(s: string): string {
  return s.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '');
}

export async function generateBrandBookContent(input: BrandBookInput): Promise<BrandBookContent> {
  const msg = await createMessage({
    model: BRANDBOOK_MODEL,
    max_tokens: 4000,
    messages: [{ role: 'user', content: buildPrompt(input) }],
  });
  const text = msg.content
    .map((b) => (b.type === 'text' ? b.text : ''))
    .join('');

  let parsed: BrandBookContent;
  try {
    parsed = JSON.parse(stripFences(text)) as BrandBookContent;
  } catch {
    // One salvage attempt: grab the outermost JSON object.
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) throw new Error('Brand book copy generation returned no JSON.');
    parsed = JSON.parse(m[0]) as BrandBookContent;
  }

  // Minimal shape guard — the template renders every field.
  const required: Array<keyof BrandBookContent> = [
    'tagline', 'intro', 'about_statement', 'aim_statement', 'vision_statement',
    'values', 'tone', 'logomark', 'logotype', 'lockup', 'clear_space',
    'minimum_sizes', 'color_intro', 'combinations', 'typeface_intro', 'closing',
  ];
  for (const k of required) {
    if (parsed[k] == null) throw new Error(`Brand book copy missing field: ${k}`);
  }
  if (!Array.isArray(parsed.values) || parsed.values.length < 4) throw new Error('Brand book copy: need 4 values.');
  if (!Array.isArray(parsed.tone) || parsed.tone.length < 4) throw new Error('Brand book copy: need 4 tone entries.');
  parsed.values = parsed.values.slice(0, 4);
  parsed.tone = parsed.tone.slice(0, 4);
  return parsed;
}

export const DEFAULT_DONTS = [
  'Do not stretch or distort the logo',
  'Do not rotate the logo',
  'Do not change the logo colors outside the approved palette',
  'Do not add shadows or effects to the logo',
  'Do not place the logo on low-contrast backgrounds',
  'Do not recreate the logotype in another typeface',
];
