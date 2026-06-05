import { and, asc, desc, eq, inArray, lt, sql } from 'drizzle-orm';
import { db } from '../../db';
import { socialQueueItems, socialQueues, type SocialQueueRow } from '../../db/schema/social';
import { getProfile } from './profile';
import { listAccounts, publishPost } from './zernio';
import { describeMedia, generateCaption, getVoiceSamples } from './caption';

// ─── Autopost queue scheduler ────────────────────────────────────────────────
// Runs hourly via cron. For each active queue with pending media:
//   1. If a post is already scheduled in the future → nothing to do (we keep
//      exactly one post in flight per queue; the next cron run tops it up).
//   2. Otherwise take the OLDEST queued item, generate description + caption,
//      compute the next slot (cadence + posting window + timezone), schedule
//      it via Zernio, mark it 'scheduled'.
// Items whose scheduledFor has passed get flipped to 'posted' (the daily
// analytics ingest later confirms with real metrics).

// Hour of day (0-23) for a Date in an IANA timezone.
function hourIn(tz: string, d: Date): number {
  const h = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    hour: 'numeric',
    hour12: false,
  }).format(d);
  return Number(h) % 24;
}

// Earliest time ≥ `from` whose local hour falls inside [startHour, endHour).
// Supports windows that wrap midnight (e.g. 22 → 2). Advances in 15-min steps,
// bounded to 14 days as a safety valve against bad configs.
export function nextSlotInWindow(from: Date, queue: Pick<SocialQueueRow, 'windowStartHour' | 'windowEndHour' | 'timezone'>): Date {
  const start = ((queue.windowStartHour % 24) + 24) % 24;
  const end = ((queue.windowEndHour % 24) + 24) % 24;
  const inWindow = (h: number) => (start < end ? h >= start && h < end : h >= start || h < end);
  if (start === end) return from; // degenerate config: window is always open

  const STEP = 15 * 60 * 1000;
  const MAX = 14 * 24 * 60 * 60 * 1000;
  let t = from.getTime();
  const limit = t + MAX;
  while (t < limit) {
    const d = new Date(t);
    if (inWindow(hourIn(queue.timezone, d))) return d;
    t += STEP;
  }
  return from;
}

// Where the next post should land: at least `cadenceHours` after the last
// scheduled/posted item (or ~10 min from now if the queue is fresh), clamped
// into the posting window.
async function computeNextSlot(queue: SocialQueueRow, now: Date): Promise<Date> {
  const [last] = await db
    .select({ scheduledFor: socialQueueItems.scheduledFor })
    .from(socialQueueItems)
    .where(
      and(
        eq(socialQueueItems.queueId, queue.id),
        inArray(socialQueueItems.status, ['scheduled', 'posted'])
      )
    )
    .orderBy(desc(socialQueueItems.scheduledFor))
    .limit(1);

  const earliest = new Date(now.getTime() + 10 * 60 * 1000);
  const afterCadence = last?.scheduledFor
    ? new Date(last.scheduledFor.getTime() + queue.cadenceHours * 60 * 60 * 1000)
    : earliest;
  const base = afterCadence > earliest ? afterCadence : earliest;
  return nextSlotInWindow(base, queue);
}

async function markItemFailed(itemId: string, error: string): Promise<void> {
  await db
    .update(socialQueueItems)
    .set({ status: 'failed', error: error.slice(0, 1000), updatedAt: sql`now()` })
    .where(eq(socialQueueItems.id, itemId));
}

// Process one queue. Returns what happened (for cron logging).
export async function processQueue(
  queue: SocialQueueRow,
  now: Date
): Promise<'idle' | 'in-flight' | 'scheduled' | 'failed' | 'no-accounts'> {
  // Flip past-due scheduled items to posted.
  await db
    .update(socialQueueItems)
    .set({ status: 'posted', updatedAt: sql`now()` })
    .where(
      and(
        eq(socialQueueItems.queueId, queue.id),
        eq(socialQueueItems.status, 'scheduled'),
        lt(socialQueueItems.scheduledFor, now)
      )
    );

  // One post in flight per queue is enough — the next run tops it up.
  const [inFlight] = await db
    .select({ id: socialQueueItems.id })
    .from(socialQueueItems)
    .where(and(eq(socialQueueItems.queueId, queue.id), eq(socialQueueItems.status, 'scheduled')))
    .limit(1);
  if (inFlight) return 'in-flight';

  // Oldest queued item is next.
  const [item] = await db
    .select()
    .from(socialQueueItems)
    .where(and(eq(socialQueueItems.queueId, queue.id), eq(socialQueueItems.status, 'queued')))
    .orderBy(asc(socialQueueItems.createdAt))
    .limit(1);
  if (!item) return 'idle';

  // Resolve Zernio accounts for the queue's target platforms.
  const profile = await getProfile(queue.userId);
  if (!profile) {
    await markItemFailed(item.id, 'No Zernio profile — connect an account first');
    return 'no-accounts';
  }
  let accounts;
  try {
    accounts = (await listAccounts(profile.profileId)).accounts ?? [];
  } catch (err) {
    // Transient Zernio error: leave the item queued, retry next hour.
    console.warn('[social:queue] listAccounts failed for', queue.userId, err);
    return 'failed';
  }
  const targets: Array<{ platform: string; accountId: string }> = [];
  for (const p of queue.platforms) {
    const acc = accounts.find((a) => (a.platform ?? '').toLowerCase() === p);
    if (acc?._id) targets.push({ platform: p, accountId: acc._id });
  }
  if (targets.length === 0) {
    await markItemFailed(item.id, `None of [${queue.platforms.join(', ')}] are connected on Zernio`);
    return 'no-accounts';
  }

  try {
    // 1. Describe (images only; videos caption from brand voice alone).
    const aiDescription =
      item.aiDescription ??
      (item.mediaType === 'image' ? await describeMedia(item.blobUrl) : null);

    // 2. Caption in the brand voice.
    const voiceSamples = await getVoiceSamples(queue.userId);
    const caption = await generateCaption({
      mediaDescription: aiDescription,
      mediaType: item.mediaType,
      fileName: item.fileName,
      brandVoice: queue.brandVoice,
      hashtags: queue.hashtags,
      platforms: targets.map((t) => t.platform),
      voiceSamples,
    });

    // 3. Schedule via Zernio at the next slot.
    const slot = await computeNextSlot(queue, now);
    const result = await publishPost({
      content: caption,
      platforms: targets,
      mediaUrls: [item.blobUrl],
      scheduledFor: slot.toISOString(),
      timezone: queue.timezone,
    });

    await db
      .update(socialQueueItems)
      .set({
        status: 'scheduled',
        aiDescription,
        caption,
        scheduledFor: slot,
        zernioPostId: result._id ?? null,
        error: null,
        updatedAt: sql`now()`,
      })
      .where(eq(socialQueueItems.id, item.id));
    return 'scheduled';
  } catch (err) {
    console.error('[social:queue] item', item.id, 'failed', err);
    await markItemFailed(item.id, (err as Error).message);
    return 'failed';
  }
}

// Cron entry point: iterate every active queue. Per-queue errors don't abort
// the loop.
export async function processAllQueues(): Promise<{
  queues: number;
  scheduled: number;
  failed: number;
}> {
  const now = new Date();
  const queues = await db.select().from(socialQueues).where(eq(socialQueues.active, true));
  let scheduled = 0;
  let failed = 0;
  for (const queue of queues) {
    try {
      const outcome = await processQueue(queue, now);
      if (outcome === 'scheduled') scheduled++;
      if (outcome === 'failed' || outcome === 'no-accounts') failed++;
    } catch (err) {
      failed++;
      console.error('[social:queue] queue', queue.id, 'threw', err);
    }
  }
  return { queues: queues.length, scheduled, failed };
}
