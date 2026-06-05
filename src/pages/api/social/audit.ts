// ─── GET/POST /api/social/audit ──────────────────────────────────────────────
// GET returns the latest cached audit. POST regenerates (cache-aware: same
// inputs hash + <7d old → returns cached without paying Claude).

import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-utils';
import { checkRateLimit } from '../../../lib/rate-limit';
import { getLatestAudit, regenerateAudit } from '../../../lib/social/audit';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  const audit = await getLatestAudit(user.id);
  return json({ audit });
};

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  if (!checkRateLimit(`social-audit:${user.id}`, 4, 60 * 60 * 1000)) {
    return json({ error: 'Too many audit runs this hour. Try again later.' }, 429);
  }

  try {
    const { insights, cached } = await regenerateAudit(user.id, user.name ?? user.email);
    if (insights.length === 0) {
      return json({ error: 'Connect an account and sync some data first.' }, 400);
    }
    return json({ insights, cached });
  } catch (err) {
    console.error('[social/audit]', err);
    return json({ error: 'Audit generation failed.' }, 500);
  }
};
