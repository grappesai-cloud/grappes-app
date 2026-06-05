// ─── POST /api/social/post ───────────────────────────────────────────────────
//   { caption, platforms: string[], mediaUrls?: string[], scheduleDate? }
// Resolves the user's connected Zernio accounts, maps the chosen platforms to
// their accountIds, and publishes (or schedules) via Zernio. Media URLs must
// be public HTTPS (Vercel Blob URLs qualify) — Zernio fetches them at post time.

import type { APIRoute } from 'astro';
import { z } from 'zod';
import { json } from '../../../lib/api-utils';
import { checkRateLimit } from '../../../lib/rate-limit';
import { listAccounts, publishPost, zernioConfigured } from '../../../lib/social/zernio';
import { getProfile } from '../../../lib/social/profile';

export const prerender = false;

const MAX_CAPTION = 2200;

const Body = z.object({
  caption: z.string().trim().min(1, 'Caption is required').max(MAX_CAPTION),
  platforms: z.array(z.string()).min(1, 'Pick at least one platform'),
  mediaUrls: z
    .array(z.string().url().startsWith('https://', 'Media URLs must be HTTPS'))
    .max(10)
    .optional(),
  scheduleDate: z.string().datetime({ offset: true }).optional(),
});

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!zernioConfigured()) {
    return json({ error: 'Social Lab is not configured (ZERNIO_API_KEY missing).' }, 503);
  }

  if (!checkRateLimit(`social-post:${user.id}`, 30, 60 * 60 * 1000)) {
    return json({ error: 'Too many posts this hour. Try again later.' }, 429);
  }

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400);
  }
  const { caption, mediaUrls, scheduleDate } = parsed.data;
  const platforms = parsed.data.platforms.map((p) => p.toLowerCase());

  const profile = await getProfile(user.id);
  if (!profile) return json({ error: 'No connected accounts yet.' }, 400);

  let accounts;
  try {
    const resp = await listAccounts(profile.profileId);
    accounts = resp.accounts ?? [];
  } catch (err) {
    return json({ error: (err as Error).message }, 502);
  }

  // Map each chosen platform to its connected accountId.
  const targets: Array<{ platform: string; accountId: string }> = [];
  for (const p of platforms) {
    const acc = accounts.find((a) => (a.platform ?? '').toLowerCase() === p);
    if (acc?._id) targets.push({ platform: p, accountId: acc._id });
  }
  if (targets.length === 0) {
    return json({ error: 'None of the chosen platforms are connected.' }, 400);
  }

  try {
    const result = await publishPost({
      content: caption,
      platforms: targets,
      mediaUrls: mediaUrls?.length ? mediaUrls : undefined,
      scheduledFor: scheduleDate ? new Date(scheduleDate).toISOString() : undefined,
    });
    return json({ ok: true, result });
  } catch (err) {
    console.error('[social/post]', err);
    return json({ error: 'Publishing failed.' }, 500);
  }
};
