// ─── GET/PUT /api/social/queue — autopost queue config ──────────────────────
// GET creates a default (paused) queue lazily so the UI always has a row.

import type { APIRoute } from 'astro';
import { eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { json } from '../../../../lib/api-utils';
import { db } from '../../../../db';
import { socialQueues } from '../../../../db/schema/social';

export const prerender = false;

const PLATFORMS = ['instagram', 'facebook', 'tiktok'] as const;

async function getOrCreateQueue(userId: string) {
  const [existing] = await db
    .select()
    .from(socialQueues)
    .where(eq(socialQueues.userId, userId))
    .limit(1);
  if (existing) return existing;

  const [created] = await db
    .insert(socialQueues)
    .values({ userId, active: false, platforms: ['instagram'] })
    .returning();
  return created;
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);
  return json({ queue: await getOrCreateQueue(user.id) });
};

const Body = z
  .object({
    active: z.boolean().optional(),
    platforms: z.array(z.enum(PLATFORMS)).min(1).optional(),
    cadenceHours: z.number().int().min(1).max(168).optional(),
    windowStartHour: z.number().int().min(0).max(23).optional(),
    windowEndHour: z.number().int().min(0).max(23).optional(),
    timezone: z.string().min(1).max(64).optional(),
    brandVoice: z.string().max(4000).nullable().optional(),
    hashtags: z.string().max(1000).nullable().optional(),
  })
  .strict();

export const PUT: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400);
  }
  if (parsed.data.timezone) {
    try {
      new Intl.DateTimeFormat('en-GB', { timeZone: parsed.data.timezone });
    } catch {
      return json({ error: `Unknown timezone: ${parsed.data.timezone}` }, 400);
    }
  }

  const queue = await getOrCreateQueue(user.id);
  const [updated] = await db
    .update(socialQueues)
    .set({ ...parsed.data, updatedAt: sql`now()` })
    .where(eq(socialQueues.id, queue.id))
    .returning();
  return json({ queue: updated });
};
