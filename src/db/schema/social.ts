import {
  pgTable,
  text,
  timestamp,
  uuid,
  pgEnum,
  integer,
  jsonb,
  index,
  uniqueIndex,
  date,
  boolean,
} from 'drizzle-orm/pg-core';
import { user } from './auth';

// ─── Social Lab (grappes.dev/social) ─────────────────────────────────────────
// Ported from Korbee's social stack, Zernio-only: Zernio (zernio.com) holds the
// platform OAuth tokens, we hold a per-user profileId. No token columns needed.

export const socialPlatform = pgEnum('social_platform', [
  'instagram',
  'facebook',
  'tiktok',
]);

// ─── social_zernio_profiles — one Zernio profile per grappes user ────────────
// Created lazily on first "Connect account". profileId is a plain Mongo _id
// (not a secret — the tenant-wide ZERNIO_API_KEY in env is the secret).

export const socialZernioProfiles = pgTable(
  'social_zernio_profiles',
  {
    userId: uuid('user_id')
      .primaryKey()
      .references(() => user.id, { onDelete: 'cascade' }),

    profileId: text('profile_id').notNull(),

    // Cached snapshot of GET /accounts?profileId= (handles + platforms).
    accountsSnapshot: jsonb('accounts_snapshot'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
  },
  (t) => [index('social_zernio_profiles_synced_idx').on(t.lastSyncAt)]
);

// ─── social_connections — one row per (user, platform) ──────────────────────

export const socialConnections = pgTable(
  'social_connections',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    platform: socialPlatform('platform').notNull(),

    // Externally-known account identity, surfaced in the UI so the user can
    // confirm "yes, that's the right account".
    externalUserId: text('external_user_id'),
    username: text('username'),
    displayName: text('display_name'),
    avatarUrl: text('avatar_url'),

    connectedAt: timestamp('connected_at', { withTimezone: true }).notNull().defaultNow(),
    lastSyncAt: timestamp('last_sync_at', { withTimezone: true }),
    lastSyncError: text('last_sync_error'),
    disconnectedAt: timestamp('disconnected_at', { withTimezone: true }),
  },
  (t) => [
    uniqueIndex('social_connections_user_platform_idx').on(t.userId, t.platform),
    index('social_connections_external_idx').on(t.platform, t.externalUserId),
  ]
);

// ─── social_metrics_daily — one row per (connection, day) ───────────────────
// Trendlines + inputs for the audit prompt.

export const socialMetricsDaily = pgTable(
  'social_metrics_daily',
  {
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => socialConnections.id, { onDelete: 'cascade' }),
    day: date('day').notNull(),

    followers: integer('followers'),
    following: integer('following'),
    postsCount: integer('posts_count'),
    engagementRate30d: integer('engagement_rate_30d_bp'), // basis points (×0.01%)
    reach28d: integer('reach_28d'),
    impressions28d: integer('impressions_28d'),
    profileViews28d: integer('profile_views_28d'),
    demographics: jsonb('demographics'),

    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('social_metrics_daily_pk').on(t.connectionId, t.day)]
);

// ─── social_posts_cache — recent posts + per-post engagement ────────────────
// The AI image description is generated once (multimodal is the expensive
// part) and reused forever for this post.

export const socialPostsCache = pgTable(
  'social_posts_cache',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    connectionId: uuid('connection_id')
      .notNull()
      .references(() => socialConnections.id, { onDelete: 'cascade' }),
    externalPostId: text('external_post_id').notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),

    mediaType: text('media_type'), // image | video | carousel | reel | story
    mediaUrl: text('media_url'),
    permalink: text('permalink'),
    caption: text('caption'),
    aiImageDescription: text('ai_image_description'),

    likes: integer('likes'),
    comments: integer('comments'),
    shares: integer('shares'),
    saves: integer('saves'),
    views: integer('views'),
    reach: integer('reach'),
    impressions: integer('impressions'),
    engagementRate: integer('engagement_rate_bp'), // basis points

    fetchedAt: timestamp('fetched_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('social_posts_cache_pk').on(t.connectionId, t.externalPostId),
    index('social_posts_cache_posted_idx').on(t.connectionId, t.postedAt),
  ]
);

// ─── social_audits — Claude-generated insights, cached by inputs hash ────────

export const socialAudits = pgTable(
  'social_audits',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    inputsHash: text('inputs_hash').notNull(),
    insights: jsonb('insights').notNull(), // SocialInsight[]
    model: text('model').notNull(),
    inputTokens: integer('input_tokens'),
    outputTokens: integer('output_tokens'),

    generatedAt: timestamp('generated_at', { withTimezone: true }).notNull().defaultNow(),
    pinnedAt: timestamp('pinned_at', { withTimezone: true }),
  },
  (t) => [
    index('social_audits_user_generated_idx').on(t.userId, t.generatedAt),
    uniqueIndex('social_audits_user_hash_idx').on(t.userId, t.inputsHash),
  ]
);

// ─── social_post_drafts — AI-generated post ideas / staged captions ─────────

export const socialDraftStatus = pgEnum('social_draft_status', [
  'idea', // AI suggested it
  'saved', // user kept it
  'copied', // user clicked "copy caption"
  'dismissed', // user said "no thanks"
]);

export const socialPostDrafts = pgTable(
  'social_post_drafts',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    platforms: socialPlatform('platforms').array().notNull(),
    concept: text('concept').notNull(),
    captionDraft: text('caption_draft').notNull(),
    hashtagOptions: jsonb('hashtag_options').notNull(), // string[][]
    suggestedTime: timestamp('suggested_time', { withTimezone: true }),
    reasoning: text('reasoning'),

    status: socialDraftStatus('status').notNull().default('idea'),
    model: text('model').notNull(),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    actedAt: timestamp('acted_at', { withTimezone: true }),
  },
  (t) => [
    index('social_post_drafts_user_created_idx').on(t.userId, t.createdAt),
    index('social_post_drafts_status_idx').on(t.userId, t.status),
  ]
);

// ─── social_queues — autopost config, one per user ──────────────────────────
// The user drops media into a Blob "folder"; the hourly cron drains it:
// describe → caption in brand voice → schedule via Zernio at the next slot.

export const socialQueues = pgTable(
  'social_queues',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    active: boolean('active').notNull().default(true),
    platforms: socialPlatform('platforms').array().notNull(),

    // Minimum hours between two scheduled posts (24 = one per day).
    cadenceHours: integer('cadence_hours').notNull().default(24),
    // Posts only land inside [windowStartHour, windowEndHour) local time.
    windowStartHour: integer('window_start_hour').notNull().default(18),
    windowEndHour: integer('window_end_hour').notNull().default(21),
    timezone: text('timezone').notNull().default('Europe/Bucharest'),

    // Free-text brand voice brief fed to the caption generator (who you are,
    // tone, niche, CTAs, language). Recent post captions are added on top.
    brandVoice: text('brand_voice'),
    // Hashtag pool, appended/blended into captions.
    hashtags: text('hashtags'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex('social_queues_user_idx').on(t.userId)]
);

// ─── social_queue_items — one media file dropped into the queue ─────────────

export const socialQueueStatus = pgEnum('social_queue_status', [
  'queued', // uploaded, waiting its turn
  'scheduled', // caption generated + handed to Zernio with scheduledFor
  'posted', // scheduled_for has passed (ingest confirms metrics later)
  'failed', // captioning or Zernio publish failed; error holds the reason
]);

export const socialQueueItems = pgTable(
  'social_queue_items',
  {
    id: uuid('id').primaryKey().defaultRandom(),
    queueId: uuid('queue_id')
      .notNull()
      .references(() => socialQueues.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),

    blobUrl: text('blob_url').notNull(),
    blobPathname: text('blob_pathname'),
    fileName: text('file_name'),
    mediaType: text('media_type').notNull(), // image | video

    // Filled by the pipeline.
    aiDescription: text('ai_description'),
    caption: text('caption'),
    scheduledFor: timestamp('scheduled_for', { withTimezone: true }),
    zernioPostId: text('zernio_post_id'),

    status: socialQueueStatus('status').notNull().default('queued'),
    error: text('error'),

    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index('social_queue_items_queue_status_idx').on(t.queueId, t.status, t.createdAt),
    index('social_queue_items_user_idx').on(t.userId, t.createdAt),
  ]
);

// ─── Type exports ────────────────────────────────────────────────────────────

export type SocialConnectionRow = typeof socialConnections.$inferSelect;
export type SocialMetricsDailyRow = typeof socialMetricsDaily.$inferSelect;
export type SocialPostCacheRow = typeof socialPostsCache.$inferSelect;
export type SocialAuditRow = typeof socialAudits.$inferSelect;
export type SocialPostDraftRow = typeof socialPostDrafts.$inferSelect;
export type SocialZernioProfileRow = typeof socialZernioProfiles.$inferSelect;
export type SocialQueueRow = typeof socialQueues.$inferSelect;
export type SocialQueueItemRow = typeof socialQueueItems.$inferSelect;

export type SocialInsight = {
  title: string;
  finding: string;
  evidence: string;
  recommendation: string;
  priority: 'high' | 'medium' | 'low';
  platform?: 'instagram' | 'facebook' | 'tiktok' | 'cross';
};
