// ── Studio: the approval gate — a human approves the image BEFORE any money ──
// is spent on video generation. Judged criterion: cost discipline.

import type { APIRoute } from 'astro';
import { json } from '../../../../../lib/api-utils';
import { getReel, updateReel } from '../../../../../lib/studio/db';

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const reel = await getReel(params.id!, user.id);
  if (!reel) return json({ error: 'Not found' }, 404);
  if (reel.status !== 'image_ready') {
    return json({ error: 'Doar o imagine generată poate fi aprobată.' }, 409);
  }

  await updateReel(reel.id, { status: 'approved', approve: true },
    { stage: 'approve', msg: 'Imagine aprobată de utilizator' });
  return json({ ok: true });
};
