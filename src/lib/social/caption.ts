import { desc, eq, inArray, isNotNull, and } from 'drizzle-orm';
import { createMessage, HAIKU_MODEL } from '../anthropic';
import { db } from '../../db';
import { socialConnections, socialPostsCache } from '../../db/schema/social';

// ─── AI caption pipeline for the autopost queue ──────────────────────────────
// 1. describeMedia: 1-2 sentence description of the image (Haiku multimodal,
//    ~$0.0001/image). Videos are skipped — no server-side frame extraction.
// 2. generateCaption: caption in the user's brand voice, grounded in the
//    media description + brand brief + the user's recent real captions.

const FETCH_TIMEOUT_MS = 15_000;
const MAX_DESCRIPTION_CHARS = 400;
const MAX_CAPTION_CHARS = 2200;

async function fetchImageAsBase64(
  url: string
): Promise<{ data: string; mediaType: 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif' }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`image fetch ${res.status}`);
    const ct = res.headers.get('content-type') ?? 'image/jpeg';
    const allowed = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;
    const mediaType = (allowed.find((m) => ct.startsWith(m)) ?? 'image/jpeg') as (typeof allowed)[number];
    const buf = await res.arrayBuffer();
    return { data: Buffer.from(buf).toString('base64'), mediaType };
  } finally {
    clearTimeout(timer);
  }
}

export async function describeMedia(url: string): Promise<string | null> {
  if (!url) return null;
  let image;
  try {
    image = await fetchImageAsBase64(url);
  } catch (err) {
    console.warn('[social:describeMedia] fetch failed:', (err as Error).message);
    return null;
  }

  try {
    const res = await createMessage({
      model: HAIKU_MODEL,
      max_tokens: 200,
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'image',
              source: { type: 'base64', media_type: image.mediaType, data: image.data },
            },
            {
              type: 'text',
              text: `This image will be published as a social-media post. In 1-2 sentences: subject, setting, mood, visual style (polished promo / phone-shot raw / studio / live shot / BTS / product / etc). Be concrete and specific.`,
            },
          ],
        },
      ],
    });
    const text = res.content
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join(' ')
      .trim();
    return text ? text.slice(0, MAX_DESCRIPTION_CHARS) : null;
  } catch (err) {
    console.warn('[social:describeMedia] anthropic error:', (err as Error).message);
    return null;
  }
}

// Pull the user's most recent real captions so the generator can match their
// voice. Empty array when analytics ingest hasn't run yet — the brand brief
// alone still produces a usable caption.
export async function getVoiceSamples(userId: string, limit = 8): Promise<string[]> {
  const connIds = (
    await db
      .select({ id: socialConnections.id })
      .from(socialConnections)
      .where(eq(socialConnections.userId, userId))
  ).map((r) => r.id);
  if (connIds.length === 0) return [];

  const rows = await db
    .select({ caption: socialPostsCache.caption })
    .from(socialPostsCache)
    .where(and(inArray(socialPostsCache.connectionId, connIds), isNotNull(socialPostsCache.caption)))
    .orderBy(desc(socialPostsCache.postedAt))
    .limit(limit);
  return rows.map((r) => (r.caption ?? '').trim()).filter((c) => c.length > 0);
}

export async function generateCaption(args: {
  mediaDescription: string | null;
  mediaType: string; // image | video
  fileName: string | null;
  brandVoice: string | null;
  hashtags: string | null;
  platforms: string[];
  voiceSamples: string[];
}): Promise<string> {
  const parts: string[] = [];
  parts.push(
    `Write ONE social media caption for a post going to: ${args.platforms.join(', ')}.`
  );
  if (args.mediaDescription) {
    parts.push(`The media is: ${args.mediaDescription}`);
  } else if (args.fileName) {
    parts.push(
      `The media is a ${args.mediaType} file named "${args.fileName}" (no visual description available — keep the caption universal, don't invent visual details).`
    );
  } else {
    parts.push(`The media is a ${args.mediaType} (no description available — keep it universal).`);
  }
  if (args.brandVoice) {
    parts.push(`Brand voice brief (follow this closely):\n${args.brandVoice}`);
  }
  if (args.voiceSamples.length > 0) {
    parts.push(
      `Recent captions by this account — match their language, tone, emoji habits and length:\n` +
        args.voiceSamples.map((s, i) => `${i + 1}. ${s.slice(0, 300)}`).join('\n')
    );
  }
  if (args.hashtags) {
    parts.push(`Hashtag pool (pick 3-6 that fit, no more): ${args.hashtags}`);
  }
  parts.push(
    `Rules:
- Reply with the caption text ONLY. No preamble, no quotes, no markdown, no alternatives.
- First line must hook in under 8 words.
- Stay under ${MAX_CAPTION_CHARS} characters including hashtags.
- Write in the same language as the brand brief / recent captions (default: the brand brief's language).
- No generic filler ("check it out", "don't miss"), no fake claims about things not in the media description.`
  );

  const res = await createMessage({
    model: HAIKU_MODEL,
    max_tokens: 700,
    messages: [{ role: 'user', content: parts.join('\n\n') }],
  });

  const caption = res.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join(' ')
    .trim();
  if (!caption) throw new Error('Caption generation returned empty text');
  return caption.slice(0, MAX_CAPTION_CHARS);
}
