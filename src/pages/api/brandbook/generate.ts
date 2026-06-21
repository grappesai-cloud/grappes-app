// ── POST /api/brandbook/generate ──────────────────────────────────────────────
// Takes the wizard answers, generates all brand-book copy with Claude, and
// stores the document as a press_kits row with mode='brand_book'.

import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-utils';
import { checkRateLimit } from '../../../lib/rate-limit';
import { createAdminClient } from '../../../lib/supabase';
import { generateBrandBookContent, DEFAULT_DONTS, type BrandBookInput } from '../../../lib/brandbook-gen';
import { fetchWebsiteContext } from '../../../lib/website-context';
import { consumeCredit, refundCredit } from '../../../lib/credits';
import { isOwnPublicUrl } from '@lib/r2-blob';

interface GenerateBody {
  name?: string;
  about?: string;
  industry?: string;
  values?: string[];
  voiceKeywords?: string[];
  colors?: Array<{ hex: string; label?: string }>;
  typeface?: string;
  logoUrl?: string;
  symbolUrl?: string;
  badgeUrl?: string;
  customFonts?: Partial<Record<'display' | 'text' | 'mono', { family?: string; url?: string; format?: string }>>;
  logoIsLight?: boolean;
  template?: string;
  website?: string;
}

type FontRole = 'display' | 'text' | 'mono';
function sanitizeFonts(
  input: GenerateBody['customFonts'],
): Record<string, { family: string; url: string; format?: string }> | null {
  if (!input || typeof input !== 'object') return null;
  const out: Record<string, { family: string; url: string; format?: string }> = {};
  for (const role of ['display', 'text', 'mono'] as FontRole[]) {
    const f = input[role];
    const url = (f?.url || '').trim();
    if (!url || !isOwnPublicUrl(url)) continue; // only our R2 uploads
    out[role] = {
      family: (f?.family || 'Custom').toString().trim().slice(0, 60) || 'Custom',
      url,
      ...(f?.format ? { format: String(f.format).slice(0, 8) } : {}),
    };
  }
  return Object.keys(out).length ? out : null;
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/;
const TYPEFACES = ['Inter', 'Archivo', 'Space Grotesk', 'Manrope', 'Work Sans', 'IBM Plex Sans', 'DM Sans', 'Sora'];
const TEMPLATES = ['editorial', 'corporate', 'urban', 'contemporary'];

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in to generate a brand book.' }, 401);

  if (!checkRateLimit(`brandbook-gen:${user.id}`, 2, 60_000)) {
    return json({ error: 'Slow down, try again in a minute.' }, 429);
  }

  let body: GenerateBody;
  try {
    body = (await request.json()) as GenerateBody;
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }

  const name = (body.name || '').trim().slice(0, 80);
  const about = (body.about || '').trim().slice(0, 1000);
  const logoUrl = (body.logoUrl || '').trim();
  if (!name) return json({ error: 'Brand name is required.' }, 400);
  if (!about) return json({ error: 'Tell us what the brand does.' }, 400);
  if (!logoUrl) return json({ error: 'Upload your logo first.' }, 400);
  // Only accept marks we hosted ourselves (the wizard upload to R2).
  if (!isOwnPublicUrl(logoUrl)) {
    return json({ error: 'Invalid logo URL.' }, 400);
  }
  const symbolUrl = (body.symbolUrl || '').trim();
  const badgeUrl = (body.badgeUrl || '').trim();
  if (symbolUrl && !isOwnPublicUrl(symbolUrl)) return json({ error: 'Invalid symbol URL.' }, 400);
  if (badgeUrl && !isOwnPublicUrl(badgeUrl)) return json({ error: 'Invalid badge URL.' }, 400);
  const customFonts = sanitizeFonts(body.customFonts);

  const typeface = TYPEFACES.includes(body.typeface || '') ? (body.typeface as string) : 'Inter';
  const template = TEMPLATES.includes(body.template || '') ? (body.template as string) : 'editorial';
  const colors = (Array.isArray(body.colors) ? body.colors : [])
    .filter((c) => c && HEX_RE.test(c.hex || ''))
    .slice(0, 4)
    .map((c) => ({ hex: c.hex.toLowerCase(), label: (c.label || '').trim().slice(0, 40) || undefined }));
  const values = (Array.isArray(body.values) ? body.values : [])
    .map((v) => (v || '').toString().trim().slice(0, 40)).filter(Boolean).slice(0, 4);
  const voiceKeywords = (Array.isArray(body.voiceKeywords) ? body.voiceKeywords : [])
    .map((v) => (v || '').toString().trim().slice(0, 30)).filter(Boolean).slice(0, 4);

  // Optional grounding from the brand's own site; best effort, never blocks.
  const websiteRaw = (body.website || '').trim().slice(0, 200);
  const website = websiteRaw ? await fetchWebsiteContext(websiteRaw) : null;

  const input: BrandBookInput = {
    name,
    about,
    industry: (body.industry || '').trim().slice(0, 80) || undefined,
    website,
    values: values.length ? values : undefined,
    voiceKeywords: voiceKeywords.length ? voiceKeywords : undefined,
    colors,
    typeface,
    logoUrl,
  };

  // Consume 1 Brand Book credit (admin-granted). Refunded if generation/save fails.
  if ((await consumeCredit(user.id, 'brandbook')) === null) {
    return json({ error: 'Nu mai ai credite Brand Book.', code: 'no_credits' }, 402);
  }

  let content;
  try {
    content = await generateBrandBookContent(input);
  } catch (err) {
    console.error('[brandbook/generate] copy generation failed:', err);
    await refundCredit(user.id, 'brandbook');
    return json({ error: 'Generation failed, please try again.' }, 502);
  }

  const slug = `${name.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 48) || 'brand'}-${Math.random().toString(36).slice(2, 8)}`;

  const client = createAdminClient();
  const { data, error } = await client
    .from('press_kits')
    .insert({
      user_id: user.id,
      mode: 'brand_book',
      status: 'draft',
      slug,
      name,
      tagline: content.tagline,
      industry: input.industry ?? null,
      voice_keywords: voiceKeywords.join(', ') || null,
      voice_paragraph: content.tone.map((t) => t.title).join(', '),
      palette_named: colors,
      links: website ? { website: website.url } : {},
      donts: DEFAULT_DONTS,
      logo_url: logoUrl,
      symbol_url: symbolUrl || null,
      badge_url: badgeUrl || null,
      custom_fonts: customFonts,
      logo_is_light: body.logoIsLight !== false,
      typeface,
      template,
      book_content: content,
    })
    .select('id')
    .single();

  if (error) {
    console.error('[brandbook/generate] insert failed:', error);
    await refundCredit(user.id, 'brandbook');
    return json({ error: 'Could not save the brand book.' }, 500);
  }

  return json({ id: data.id });
};
