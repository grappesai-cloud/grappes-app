import { and, desc, eq, gte, isNull, inArray } from 'drizzle-orm';
import { db } from '../../db';
import {
  socialConnections,
  socialMetricsDaily,
  socialPostsCache,
  type SocialConnectionRow,
  type SocialMetricsDailyRow,
  type SocialPostCacheRow,
} from '../../db/schema/social';

// ─── Pure data assembly + statistics for the audit and the scheduler ─────────
// No AI calls in here, just numbers and strings the prompts consume.

export type ContentMix = {
  total: number;
  reels: number;
  staticImages: number;
  carousels: number;
  reelShare: number; // 0..1
};

export type ContentSignals = {
  contentMix: ContentMix;
  topPosts: SocialPostCacheRow[]; // by engagement rate, up to 8
  bottomPosts: SocialPostCacheRow[]; // up to 4, only with enough posts
  hourEngagement: { hour: number; avgEngagementBp: number; count: number }[];
  dowEngagement: { dow: number; avgEngagementBp: number; count: number }[];
  daysSinceLastPost: number | null;
};

const REEL_TYPES = new Set(['REELS', 'VIDEO', 'video', 'reel']);
const CAROUSEL_TYPES = new Set(['CAROUSEL_ALBUM', 'carousel']);

function classify(post: SocialPostCacheRow): 'reel' | 'carousel' | 'static' {
  if (post.mediaType && REEL_TYPES.has(post.mediaType)) return 'reel';
  if (post.mediaType && CAROUSEL_TYPES.has(post.mediaType)) return 'carousel';
  return 'static';
}

export function computeContentMix(posts: SocialPostCacheRow[]): ContentMix {
  let reels = 0;
  let carousels = 0;
  let staticImages = 0;
  for (const p of posts) {
    const k = classify(p);
    if (k === 'reel') reels++;
    else if (k === 'carousel') carousels++;
    else staticImages++;
  }
  const total = posts.length;
  return { total, reels, staticImages, carousels, reelShare: total === 0 ? 0 : reels / total };
}

export function computeContentSignals(posts: SocialPostCacheRow[]): ContentSignals {
  const contentMix = computeContentMix(posts);

  const sortedByEng = [...posts].sort((a, b) => (b.engagementRate ?? -1) - (a.engagementRate ?? -1));
  const topPosts = sortedByEng.slice(0, 8);
  const bottomPosts = posts.length >= 12 ? sortedByEng.slice(-4).reverse() : [];

  // Hour-of-day / day-of-week binning in UTC; callers convert to the user's
  // timezone for display and scheduling.
  const hourBins: Map<number, { sum: number; n: number }> = new Map();
  const dowBins: Map<number, { sum: number; n: number }> = new Map();
  for (const p of posts) {
    if (p.engagementRate === null || p.engagementRate === undefined) continue;
    const date = new Date(p.postedAt);
    const hb = hourBins.get(date.getUTCHours()) ?? { sum: 0, n: 0 };
    hb.sum += p.engagementRate;
    hb.n += 1;
    hourBins.set(date.getUTCHours(), hb);
    const db_ = dowBins.get(date.getUTCDay()) ?? { sum: 0, n: 0 };
    db_.sum += p.engagementRate;
    db_.n += 1;
    dowBins.set(date.getUTCDay(), db_);
  }
  const hourEngagement = Array.from(hourBins.entries())
    .map(([hour, b]) => ({ hour, avgEngagementBp: Math.round(b.sum / b.n), count: b.n }))
    .sort((a, b) => b.avgEngagementBp - a.avgEngagementBp);
  const dowEngagement = Array.from(dowBins.entries())
    .map(([dow, b]) => ({ dow, avgEngagementBp: Math.round(b.sum / b.n), count: b.n }))
    .sort((a, b) => b.avgEngagementBp - a.avgEngagementBp);

  let daysSinceLastPost: number | null = null;
  if (posts.length > 0) {
    const newest = posts.reduce((a, b) => (a.postedAt.getTime() > b.postedAt.getTime() ? a : b));
    daysSinceLastPost = Math.floor((Date.now() - newest.postedAt.getTime()) / 86_400_000);
  }

  return { contentMix, topPosts, bottomPosts, hourEngagement, dowEngagement, daysSinceLastPost };
}

// ─── Best posting hour (UTC) across all the user's platforms ─────────────────
// Needs at least 2 posts in the winning bucket to count as a signal; returns
// null until the analytics ingest has built enough history.
export async function bestPostingHourUtc(userId: string): Promise<number | null> {
  const connIds = (
    await db
      .select({ id: socialConnections.id })
      .from(socialConnections)
      .where(and(eq(socialConnections.userId, userId), isNull(socialConnections.disconnectedAt)))
  ).map((r) => r.id);
  if (connIds.length === 0) return null;

  const posts = await db
    .select()
    .from(socialPostsCache)
    .where(inArray(socialPostsCache.connectionId, connIds))
    .orderBy(desc(socialPostsCache.postedAt))
    .limit(100);

  const signals = computeContentSignals(posts);
  const best = signals.hourEngagement.find((h) => h.count >= 2);
  return best ? best.hour : null;
}

// ─── Audit inputs ─────────────────────────────────────────────────────────────

export type SocialAuditInputs = {
  connections: SocialConnectionRow[];
  metricsByConnection: Record<string, SocialMetricsDailyRow[]>;
  postsByConnection: Record<string, SocialPostCacheRow[]>;
  signalsByConnection: Record<string, ContentSignals>;
};

export async function gatherAuditInputs(userId: string): Promise<SocialAuditInputs> {
  const connections = await db
    .select()
    .from(socialConnections)
    .where(and(eq(socialConnections.userId, userId), isNull(socialConnections.disconnectedAt)));

  const ninetyDaysAgo = new Date(Date.now() - 90 * 86_400 * 1000);
  const sixtyDaysAgo = new Date(Date.now() - 60 * 86_400 * 1000);

  const metricsByConnection: Record<string, SocialMetricsDailyRow[]> = {};
  const postsByConnection: Record<string, SocialPostCacheRow[]> = {};
  const signalsByConnection: Record<string, ContentSignals> = {};

  for (const conn of connections) {
    metricsByConnection[conn.id] = await db
      .select()
      .from(socialMetricsDaily)
      .where(
        and(
          eq(socialMetricsDaily.connectionId, conn.id),
          gte(socialMetricsDaily.day, ninetyDaysAgo.toISOString().slice(0, 10))
        )
      )
      .orderBy(desc(socialMetricsDaily.day));

    const posts = await db
      .select()
      .from(socialPostsCache)
      .where(
        and(
          eq(socialPostsCache.connectionId, conn.id),
          gte(socialPostsCache.postedAt, sixtyDaysAgo)
        )
      )
      .orderBy(desc(socialPostsCache.postedAt))
      .limit(50);
    postsByConnection[conn.id] = posts;
    signalsByConnection[conn.id] = computeContentSignals(posts);
  }

  return { connections, metricsByConnection, postsByConnection, signalsByConnection };
}
