// ─── POST /api/social/disconnect ─────────────────────────────────────────────
// Deletes the user's Zernio profile (revokes all linked accounts on Zernio's
// side) and marks local connections as disconnected. Historic metrics/posts
// stay viewable.

import type { APIRoute } from 'astro';
import { eq, sql } from 'drizzle-orm';
import { json } from '../../../lib/api-utils';
import { db } from '../../../db';
import { socialConnections } from '../../../db/schema/social';
import { deleteProfile } from '../../../lib/social/profile';

export const prerender = false;

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  try {
    await deleteProfile(user.id);
    await db
      .update(socialConnections)
      .set({ disconnectedAt: sql`now()` })
      .where(eq(socialConnections.userId, user.id));
    return json({ ok: true });
  } catch (err) {
    console.error('[social/disconnect]', err);
    return json({ error: 'Disconnect failed.' }, 500);
  }
};
