// ─── Onboarding URL Ingestion ────────────────────────────────────────────────
// User pastes a public link (Drive folder, Spotify, SoundCloud, YouTube,
// Apple Music). We extract usable assets (image URLs) or embeds and merge
// them into the brief so site generation can use them.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { ingestUrl } from '../../../../lib/url-ingest';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { json } from '../../../../lib/api-utils';

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`ingest-url:${user.id}`, 30, 3_600_000)) {
    return json({ error: 'Too many ingestion requests. Please wait.' }, 429);
  }

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const body = await request.json().catch(() => ({}));
  const url = (body as any).url as string | undefined;
  if (!url || !url.trim()) return json({ error: 'url is required' }, 400);

  let result;
  try {
    result = await ingestUrl(url.trim());
  } catch (e: any) {
    console.error('[ingest-url]', e?.message || e);
    return json({ error: `Ingestion failed: ${e?.message || 'unknown'}` }, 500);
  }

  if (result.source === 'unknown') {
    return json({
      ok: false,
      source: 'unknown',
      summary: result.summary,
    });
  }

  // Merge into brief.data.media so the generation pipeline can use it.
  const brief = await db.briefs.findByProjectId(params.projectId!);
  const currentMedia = (brief?.data as any)?.media ?? {};

  // Drive images → media.linkImages (new bucket; not photos but referenceable URLs)
  // Audio/Video embeds → media.audio_embeds (string array — existing prompt path)
  const linkImages: any[]     = Array.isArray(currentMedia.linkImages)  ? [...currentMedia.linkImages]  : [];
  const audioEmbeds: string[] = Array.isArray(currentMedia.audio_embeds) ? [...currentMedia.audio_embeds] : [];

  for (const a of result.assets) {
    if (a.kind === 'image') {
      if (!linkImages.some((x: any) => x?.url === a.url)) {
        linkImages.push({
          source:    result.source,
          url:       a.url,
          title:     a.title,
          mimeType:  a.mimeType,
          thumbnail: a.thumbnail,
        });
      }
    } else {
      // audio_embed / video_embed → push canonical URL the prompt already handles
      const canonical = a.url;
      if (!audioEmbeds.includes(canonical)) audioEmbeds.push(canonical);
    }
  }

  await db.briefs.merge(params.projectId!, {
    'media.linkImages':   linkImages,
    'media.audio_embeds': audioEmbeds,
  });

  return json({
    ok:         true,
    source:     result.source,
    summary:    result.summary,
    assetCount: result.assets.length,
    images:     linkImages.length,
    embeds:     audioEmbeds.length,
  });
};
