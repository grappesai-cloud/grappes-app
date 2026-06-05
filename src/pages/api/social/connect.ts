// ─── POST /api/social/connect { platform } ───────────────────────────────────
// Returns { url } — Zernio's hosted OAuth authUrl. The client redirects the
// browser there; Zernio links the account under the user's profile using its
// own pre-approved Meta/TikTok apps (no grappes app review needed).

import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-utils';
import { e } from '../../../lib/env';
import { getConnectUrl, zernioConfigured } from '../../../lib/social/zernio';
import { getOrCreateProfile } from '../../../lib/social/profile';

export const prerender = false;

// Platforms surfaced in Social Lab today. Zernio supports more, but the
// social_platform enum + ingest only map these.
const ALLOWED = new Set(['instagram', 'facebook', 'tiktok']);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  if (!zernioConfigured()) {
    return json({ error: 'Social Lab is not configured (ZERNIO_API_KEY missing).' }, 503);
  }

  const body = (await request.json().catch(() => ({}))) as { platform?: string };
  const platform = (body.platform ?? '').toLowerCase();
  if (!ALLOWED.has(platform)) {
    return json({ error: `Unsupported platform: ${platform || '(none)'}` }, 400);
  }

  const siteUrl = (e('PUBLIC_SITE_URL') || 'https://grappes.dev').replace(/\/$/, '');
  const redirect = `${siteUrl}/social?connected=${platform}`;

  try {
    const { profileId } = await getOrCreateProfile(
      user.id,
      user.name ?? user.email ?? `Grappes ${user.id}`
    );
    const { authUrl } = await getConnectUrl(platform, profileId, redirect);
    return json({ url: authUrl });
  } catch (err) {
    console.error('[social/connect]', err);
    return json({ error: 'Could not start the connect flow.' }, 500);
  }
};
