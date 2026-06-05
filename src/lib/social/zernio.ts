import { e } from '../env';

// ─── Zernio (formerly getlate.dev) REST client ───────────────────────────────
// Ported from Korbee, where the integration is verified live:
//   GET  /accounts                       -> { accounts, hasAnalyticsAccess }
//   POST /profiles {name}                -> { profile: { _id, ... } }
//   GET  /connect/{platform}?profileId=  -> { authUrl, state }
//   POST /posts                          -> publish or schedule
//   GET  /analytics?profileId=&fromDate=&toDate= -> per-post metrics
// Auth is a single tenant-wide Bearer sk_... key; per-user isolation is the
// profileId query param (NOT a secret, just a Mongo _id).
const BASE = 'https://zernio.com/api/v1';

export function zernioConfigured(): boolean {
  return Boolean(e('ZERNIO_API_KEY'));
}

type CallOptions = {
  method?: 'GET' | 'POST' | 'DELETE' | 'PUT';
  body?: unknown;
  query?: Record<string, string | number | boolean | undefined>;
};

async function call<T>(path: string, options: CallOptions = {}): Promise<T> {
  const apiKey = e('ZERNIO_API_KEY');
  if (!apiKey) throw new Error('ZERNIO_API_KEY is not set');

  let url = `${BASE}${path}`;
  if (options.query) {
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) params.set(k, String(v));
    }
    const qs = params.toString();
    if (qs) url += (url.includes('?') ? '&' : '?') + qs;
  }

  const res = await fetch(url, {
    method: options.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    // 402 = "Analytics add-on required" on some accounts; surface verbatim.
    throw new Error(`Zernio ${res.status} ${path}: ${text.slice(0, 500)}`);
  }
  return text ? (JSON.parse(text) as T) : ({} as T);
}

// ─── Profiles — one Zernio profile per grappes user ──────────────────────────

export type ZernioProfile = {
  _id: string;
  name: string;
  userId?: string;
};

export async function createProfile(name: string): Promise<ZernioProfile> {
  const data = await call<{ profile: ZernioProfile }>('/profiles', {
    method: 'POST',
    body: { name },
  });
  return data.profile;
}

export async function deleteProfile(profileId: string): Promise<void> {
  await call(`/profiles/${profileId}`, { method: 'DELETE' }).catch(() => {});
}

// ─── Connect — hosted OAuth via Zernio's own pre-approved apps ───────────────
// Returns the authUrl the user opens; on completion Zernio links the account
// under the profile and redirects back to `redirect`.

export type ZernioConnectResult = { authUrl: string; state?: string };

export async function getConnectUrl(
  platform: string,
  profileId: string,
  redirect?: string
): Promise<ZernioConnectResult> {
  // Zernio expects `redirect_url` (not `redirect`).
  return call('/connect/' + platform, {
    query: { profileId, redirect_url: redirect },
  });
}

// ─── Accounts — connected social accounts under a profile ───────────────────

export type ZernioAccount = {
  _id: string;
  platform: string;
  username?: string;
  displayName?: string;
  name?: string;
  profilePictureUrl?: string;
  avatarUrl?: string;
  externalId?: string;
  followersCount?: number;
  followers?: number;
  [k: string]: unknown;
};

export async function listAccounts(
  profileId?: string
): Promise<{ accounts: ZernioAccount[]; hasAnalyticsAccess?: boolean }> {
  return call('/accounts', { query: { profileId } });
}

// ─── Publishing — POST /posts. Schedulable to multiple accounts at once ─────
//   body: { content, scheduledFor?, timezone?, mediaUrls?, platforms: [{platform, accountId}] }
// Omit scheduledFor to publish immediately.

export type ZernioPublishInput = {
  content: string;
  platforms: Array<{ platform: string; accountId: string }>;
  scheduledFor?: string;
  timezone?: string;
  mediaUrls?: string[];
};

export type ZernioPublishResult = {
  _id?: string;
  status?: string;
  errors?: unknown;
  [k: string]: unknown;
};

export async function publishPost(input: ZernioPublishInput): Promise<ZernioPublishResult> {
  return call('/posts', { method: 'POST', body: input });
}

// ─── Analytics — per-post metrics (last 90d by default, paginated) ──────────

export type ZernioPostMetrics = {
  impressions?: number;
  reach?: number;
  likes?: number;
  comments?: number;
  shares?: number;
  saves?: number;
  clicks?: number;
  views?: number;
  engagementRate?: number;
  igReelsAvgWatchTime?: number;
  igReelsVideoViewTotalTime?: number;
  lastUpdated?: string;
};

// Live shape (confirmed in Korbee): per-post metrics are nested under
// `analytics`, with a per-platform breakdown under `platforms[].analytics`.
export type ZernioAnalyticsPost = {
  _id?: string;
  latePostId?: string | null;
  platform?: string;
  content?: string;
  publishedAt?: string;
  scheduledFor?: string;
  platformPostUrl?: string;
  thumbnailUrl?: string;
  mediaType?: string;
  status?: string;
  isExternal?: boolean;
  analytics?: ZernioPostMetrics;
  platforms?: Array<{
    platform?: string;
    accountId?: string;
    platformPostUrl?: string;
    analytics?: ZernioPostMetrics;
  }>;
};

export type ZernioAnalyticsResponse = {
  posts?: ZernioAnalyticsPost[];
  data?: ZernioAnalyticsPost[];
  pagination?: { page?: number; limit?: number; total?: number };
  [k: string]: unknown;
};

export async function getAnalytics(args: {
  profileId?: string;
  accountId?: string;
  platform?: string;
  fromDate?: string; // YYYY-MM-DD
  toDate?: string;
  limit?: number;
  page?: number;
}): Promise<ZernioAnalyticsResponse> {
  return call('/analytics', {
    query: {
      profileId: args.profileId,
      accountId: args.accountId,
      platform: args.platform,
      fromDate: args.fromDate,
      toDate: args.toDate,
      limit: args.limit ?? 100,
      page: args.page ?? 1,
      source: 'all',
    },
  });
}
