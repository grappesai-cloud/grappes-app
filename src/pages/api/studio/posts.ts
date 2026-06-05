// ── Savoy admin: post scheduler (create + list) ──────────────────────────────

import type { APIRoute } from 'astro';
import { getPg } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

const PLATFORMS = new Set(['instagram', 'tiktok', 'facebook']);

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const sql = getPg();
  const rows = await sql`
    SELECT p.*, r.title AS reel_title, r.video_url, r.mode
    FROM savoy_posts p
    JOIN studio_reels r ON r.id = p.reel_id
    WHERE p.user_id = ${user.id}
    ORDER BY p.scheduled_at ASC
    LIMIT 100
  `;
  return json({ posts: rows });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const reelId = body?.reelId;
  const caption = (body?.caption ?? '').trim();
  const platforms = Array.isArray(body?.platforms)
    ? body.platforms.filter((p: string) => PLATFORMS.has(p))
    : [];
  const scheduledAt = body?.scheduledAt ? new Date(body.scheduledAt) : null;

  if (!reelId) return json({ error: 'Alege un reel.' }, 400);
  if (!caption) return json({ error: 'Scrie un caption.' }, 400);
  if (platforms.length === 0) return json({ error: 'Alege cel puțin o platformă.' }, 400);
  if (!scheduledAt || isNaN(scheduledAt.getTime())) return json({ error: 'Alege data și ora.' }, 400);

  const sql = getPg();
  const reel = await sql`
    SELECT id, status FROM studio_reels WHERE id = ${reelId} AND user_id = ${user.id} LIMIT 1
  `;
  if (!reel[0]) return json({ error: 'Reel inexistent.' }, 404);
  if (reel[0].status !== 'complete') return json({ error: 'Doar un reel finalizat poate fi programat.' }, 409);

  const rows = await sql`
    INSERT INTO savoy_posts (user_id, reel_id, caption, platforms, scheduled_at)
    VALUES (${user.id}, ${reelId}, ${caption}, ${platforms}, ${scheduledAt.toISOString()})
    RETURNING id
  `;
  return json({ id: rows[0].id }, 201);
};
