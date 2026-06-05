// ─── GET/POST /api/social/queue/items ────────────────────────────────────────
// GET lists the user's queue items (newest first). POST registers one or more
// freshly uploaded Blob files as queue items.

import type { APIRoute } from 'astro';
import { desc, eq } from 'drizzle-orm';
import { z } from 'zod';
import { json } from '../../../../lib/api-utils';
import { db } from '../../../../db';
import { socialQueueItems, socialQueues } from '../../../../db/schema/social';

export const prerender = false;

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const items = await db
    .select()
    .from(socialQueueItems)
    .where(eq(socialQueueItems.userId, user.id))
    .orderBy(desc(socialQueueItems.createdAt))
    .limit(200);
  return json({ items });
};

const Item = z.object({
  blobUrl: z.string().url().startsWith('https://'),
  blobPathname: z.string().optional(),
  fileName: z.string().max(300).optional(),
  mediaType: z.enum(['image', 'video']),
});
const Body = z.object({ items: z.array(Item).min(1).max(50) });

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const parsed = Body.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return json({ error: parsed.error.issues[0]?.message ?? 'Invalid body' }, 400);
  }

  const [queue] = await db
    .select({ id: socialQueues.id })
    .from(socialQueues)
    .where(eq(socialQueues.userId, user.id))
    .limit(1);
  if (!queue) return json({ error: 'Configure your queue first (GET /api/social/queue).' }, 400);

  const created = await db
    .insert(socialQueueItems)
    .values(
      parsed.data.items.map((i) => ({
        queueId: queue.id,
        userId: user.id,
        blobUrl: i.blobUrl,
        blobPathname: i.blobPathname ?? null,
        fileName: i.fileName ?? null,
        mediaType: i.mediaType,
      }))
    )
    .returning();
  return json({ items: created });
};
