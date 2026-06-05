// ─── GET /api/social/connections ─────────────────────────────────────────────
// Lists the user's connected platforms (username, avatar, followers, last
// sync) for the Social Lab dashboard.

import type { APIRoute } from 'astro';
import { and, desc, eq, isNull } from 'drizzle-orm';
import { json } from '../../../lib/api-utils';
import { db } from '../../../db';
import { socialConnections, socialMetricsDaily } from '../../../db/schema/social';
import { getProfile } from '../../../lib/social/profile';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const profile = await getProfile(user.id);

  const rows = await db
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, user.id), isNull(socialConnections.disconnectedAt)));

  const connections = await Promise.all(
    rows.map(async (c) => {
      const [latest] = await db
        .select({ followers: socialMetricsDaily.followers, day: socialMetricsDaily.day })
        .from(socialMetricsDaily)
        .where(eq(socialMetricsDaily.connectionId, c.id))
        .orderBy(desc(socialMetricsDaily.day))
        .limit(1);
      return {
        id: c.id,
        platform: c.platform,
        username: c.username,
        displayName: c.displayName,
        avatarUrl: c.avatarUrl,
        followers: latest?.followers ?? null,
        connectedAt: c.connectedAt,
        lastSyncAt: c.lastSyncAt,
        lastSyncError: c.lastSyncError,
      };
    })
  );

  return json({ hasProfile: Boolean(profile), connections });
};
