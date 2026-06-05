// ─── DELETE /api/social/queue/items/:id ──────────────────────────────────────
// Removes a queue item and its Blob file. Only 'queued' and 'failed' items can
// be deleted — once handed to Zernio ('scheduled'/'posted') the media URL must
// stay alive for Zernio to fetch at publish time.

import type { APIRoute } from 'astro';
import { and, eq, inArray } from 'drizzle-orm';
import { del } from '@vercel/blob';
import { json } from '../../../../../lib/api-utils';
import { db } from '../../../../../db';
import { socialQueueItems } from '../../../../../db/schema/social';

export const prerender = false;

export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const id = params.id ?? '';
  if (!id) return json({ error: 'Missing item id' }, 400);

  const [item] = await db
    .select()
    .from(socialQueueItems)
    .where(and(eq(socialQueueItems.id, id), eq(socialQueueItems.userId, user.id)))
    .limit(1);
  if (!item) return json({ error: 'Not found' }, 404);
  if (item.status === 'scheduled' || item.status === 'posted') {
    return json({ error: `Cannot delete a ${item.status} item.` }, 409);
  }

  await db
    .delete(socialQueueItems)
    .where(
      and(
        eq(socialQueueItems.id, id),
        eq(socialQueueItems.userId, user.id),
        inArray(socialQueueItems.status, ['queued', 'failed'])
      )
    );

  // Best-effort Blob cleanup; the DB row is the source of truth.
  try {
    await del(item.blobUrl);
  } catch (err) {
    console.warn('[social/queue/items] blob delete failed:', (err as Error).message);
  }

  return json({ ok: true });
};
