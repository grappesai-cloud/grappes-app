import { and, eq, sql } from 'drizzle-orm';
import { db } from '../../db';
import {
  socialConnections,
  socialMetricsDaily,
  socialPostsCache,
  socialZernioProfiles,
} from '../../db/schema/social';
import * as zernio from './zernio';

// Only the three platforms the social_platform enum supports today. Zernio
// also returns youtube/twitter/etc; those are ignored until we widen the enum.
const PLATFORM_MAP: Record<string, 'instagram' | 'facebook' | 'tiktok'> = {
  instagram: 'instagram',
  facebook: 'facebook',
  facebook_page: 'facebook',
  facebookPage: 'facebook',
  tiktok: 'tiktok',
};

type SupportedPlatform = 'instagram' | 'facebook' | 'tiktok';

function toInt(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return Math.round(v);
  if (typeof v === 'string') {
    const n = Number(v);
    if (Number.isFinite(n)) return Math.round(n);
  }
  return null;
}

async function upsertConnectionRow(args: {
  userId: string;
  platform: SupportedPlatform;
  username: string | null;
  displayName: string | null;
  avatarUrl: string | null;
  externalUserId: string | null;
}): Promise<string> {
  const existing = await db
    .select({ id: socialConnections.id })
    .from(socialConnections)
    .where(
      and(
        eq(socialConnections.userId, args.userId),
        eq(socialConnections.platform, args.platform)
      )
    )
    .limit(1);

  if (existing[0]) {
    await db
      .update(socialConnections)
      .set({
        username: args.username,
        displayName: args.displayName,
        avatarUrl: args.avatarUrl,
        externalUserId: args.externalUserId,
        disconnectedAt: null,
        lastSyncAt: sql`now()`,
        lastSyncError: null,
      })
      .where(eq(socialConnections.id, existing[0].id));
    return existing[0].id;
  }

  const [created] = await db
    .insert(socialConnections)
    .values({
      userId: args.userId,
      platform: args.platform,
      externalUserId: args.externalUserId,
      username: args.username,
      displayName: args.displayName,
      avatarUrl: args.avatarUrl,
    })
    .returning({ id: socialConnections.id });
  return created.id;
}

// Pull accounts + per-post analytics for one Zernio profile and write them
// into the shared social_* tables the audit/insights pipeline reads.
export async function ingestForUser(
  userId: string
): Promise<{ platforms: number; postsTouched: number }> {
  const [profile] = await db
    .select()
    .from(socialZernioProfiles)
    .where(eq(socialZernioProfiles.userId, userId))
    .limit(1);
  if (!profile) return { platforms: 0, postsTouched: 0 };

  // 1. Connected accounts → connection rows + follower snapshot.
  let accountsResp: Awaited<ReturnType<typeof zernio.listAccounts>>;
  try {
    accountsResp = await zernio.listAccounts(profile.profileId);
  } catch (err) {
    await db
      .update(socialZernioProfiles)
      .set({ lastSyncError: (err as Error).message })
      .where(eq(socialZernioProfiles.userId, userId));
    throw err;
  }

  const accounts = (accountsResp.accounts ?? []).filter(
    (a) => (a.platform ?? '') in PLATFORM_MAP
  );

  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const day = today.toISOString().slice(0, 10);

  const connByPlatform = new Map<SupportedPlatform, string>();
  for (const acc of accounts) {
    const platform = PLATFORM_MAP[acc.platform];
    const connId = await upsertConnectionRow({
      userId,
      platform,
      username: acc.username ?? acc.name ?? acc.displayName ?? null,
      displayName: acc.displayName ?? acc.name ?? null,
      avatarUrl: acc.profilePictureUrl ?? acc.avatarUrl ?? null,
      externalUserId: acc.externalId ?? acc._id ?? null,
    });
    connByPlatform.set(platform, connId);

    const followers = toInt(acc.followersCount) ?? toInt(acc.followers) ?? null;
    await db
      .insert(socialMetricsDaily)
      .values({ connectionId: connId, day, followers })
      .onConflictDoUpdate({
        target: [socialMetricsDaily.connectionId, socialMetricsDaily.day],
        set: { followers, capturedAt: sql`now()` },
      });
  }

  if (connByPlatform.size === 0) {
    await db
      .update(socialZernioProfiles)
      .set({
        lastSyncAt: new Date(),
        lastSyncError: null,
        accountsSnapshot: accountsResp,
      })
      .where(eq(socialZernioProfiles.userId, userId));
    return { platforms: 0, postsTouched: 0 };
  }

  // 2. Per-post analytics for the profile (last 90d by default).
  let analytics: zernio.ZernioAnalyticsResponse = {};
  try {
    analytics = await zernio.getAnalytics({ profileId: profile.profileId });
  } catch (err) {
    // 402 "Analytics add-on required" lands here; record but don't fail the
    // whole sync — follower snapshots above are still useful.
    console.warn('[social:ingest] /analytics failed', err);
    await db
      .update(socialZernioProfiles)
      .set({ lastSyncError: (err as Error).message, lastSyncAt: new Date() })
      .where(eq(socialZernioProfiles.userId, userId));
    return { platforms: connByPlatform.size, postsTouched: 0 };
  }

  const posts = analytics.posts ?? analytics.data ?? [];
  let postsTouched = 0;
  for (const post of posts) {
    const rawPlatform = post.platform ?? '';
    const platform = PLATFORM_MAP[rawPlatform];
    if (!platform) continue;
    const connId = connByPlatform.get(platform);
    if (!connId) continue;

    const externalPostId = post._id ?? post.latePostId ?? post.platformPostUrl;
    if (!externalPostId) continue;

    // Metrics live under `analytics`; prefer the per-platform breakdown.
    const m =
      post.platforms?.find((p) => p.platform === rawPlatform)?.analytics ??
      post.analytics ??
      {};
    const postedAt = post.publishedAt
      ? new Date(post.publishedAt)
      : post.scheduledFor
        ? new Date(post.scheduledFor)
        : new Date();

    const values = {
      mediaType: post.mediaType ?? null,
      mediaUrl: post.thumbnailUrl ?? null,
      permalink: post.platformPostUrl ?? null,
      caption: post.content ?? null,
      likes: toInt(m.likes),
      comments: toInt(m.comments),
      shares: toInt(m.shares),
      saves: toInt(m.saves),
      views: toInt(m.views),
      reach: toInt(m.reach),
      impressions: toInt(m.impressions),
      engagementRate:
        typeof m.engagementRate === 'number'
          ? Math.round(m.engagementRate * 100) // store as basis points
          : null,
    };

    await db
      .insert(socialPostsCache)
      .values({ connectionId: connId, externalPostId, postedAt, ...values })
      .onConflictDoUpdate({
        target: [socialPostsCache.connectionId, socialPostsCache.externalPostId],
        set: { ...values, fetchedAt: sql`now()` },
      });
    postsTouched++;
  }

  await db
    .update(socialZernioProfiles)
    .set({
      lastSyncAt: new Date(),
      lastSyncError: null,
      accountsSnapshot: accountsResp,
    })
    .where(eq(socialZernioProfiles.userId, userId));

  return { platforms: connByPlatform.size, postsTouched };
}

// Cron entry point: iterate every Zernio profile. Per-user errors are logged
// but don't abort the loop.
export async function ingestAllUsers(): Promise<{
  users: number;
  totalPostsTouched: number;
  failed: number;
}> {
  const profiles = await db
    .select({ userId: socialZernioProfiles.userId })
    .from(socialZernioProfiles);
  let users = 0;
  let totalPostsTouched = 0;
  let failed = 0;
  for (const { userId } of profiles) {
    try {
      const r = await ingestForUser(userId);
      users++;
      totalPostsTouched += r.postsTouched;
    } catch (err) {
      failed++;
      console.error('[social:ingest] user', userId, 'failed', err);
    }
  }
  return { users, totalPostsTouched, failed };
}
