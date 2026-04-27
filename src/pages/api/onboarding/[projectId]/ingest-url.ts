// ─── Onboarding URL Ingestion ────────────────────────────────────────────────
// User pastes a Spotify / SoundCloud / YouTube / Apple Music link. We extract
// canonical embed URLs and merge them into the brief so site generation
// renders a "Music" / "Listen" section with iframes.
//
// For bulk image uploads use the zip upload flow (drag a .zip in chat) — much
// faster and works without external auth.

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
    return json({ ok: false, source: 'unknown', summary: result.summary });
  }

  // Merge canonical embed URLs into media.audio_embeds — the existing prompt
  // path already turns these into iframe sections.
  const brief = await db.briefs.findByProjectId(params.projectId!);
  const currentMedia = (brief?.data as any)?.media ?? {};
  const audioEmbeds: string[] = Array.isArray(currentMedia.audio_embeds) ? [...currentMedia.audio_embeds] : [];

  for (const a of result.assets) {
    const canonical = a.url;
    if (!audioEmbeds.includes(canonical)) audioEmbeds.push(canonical);
  }

  await db.briefs.merge(params.projectId!, { 'media.audio_embeds': audioEmbeds });

  return json({
    ok:         true,
    source:     result.source,
    summary:    result.summary,
    assetCount: result.assets.length,
    embeds:     audioEmbeds.length,
  });
};
