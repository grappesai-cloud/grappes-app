import { createHash } from 'node:crypto';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '../../db';
import {
  socialAudits,
  socialQueues,
  type SocialInsight,
  type SocialPostCacheRow,
  type SocialMetricsDailyRow,
} from '../../db/schema/social';
import { createMessage, HAIKU_MODEL } from '../anthropic';
import { gatherAuditInputs, type ContentSignals } from './insights';

// ─── Audit pipeline — Haiku, reels-aware, cached by inputs hash ──────────────
// Ported from Korbee; gig context replaced with the user's brand voice brief.

const MAX_AUDIT_AGE_MS = 7 * 86_400 * 1000;

// Capture only the data points that should invalidate a cached audit. If
// posts haven't changed and followers are the same, don't pay Claude again.
function buildInputsHash(parts: {
  postsLatestPostedAt: number;
  postsCount: number;
  followers: number | null;
  followers30dAgo: number | null;
  reelShareBp: number;
}): string {
  return createHash('sha256').update(JSON.stringify(parts)).digest('base64url').slice(0, 32);
}

// Compact a post into a few lines for the prompt.
function fmtPost(p: SocialPostCacheRow, platform: string): string {
  const eng = p.engagementRate ? `${(p.engagementRate / 100).toFixed(2)}%` : 'n/a';
  const reach = p.reach ?? p.views ?? null;
  const date = p.postedAt.toISOString().slice(0, 10);
  const cap = (p.caption ?? '').replace(/\s+/g, ' ').slice(0, 140);
  const desc = (p.aiImageDescription ?? '').slice(0, 200);
  return [
    `[${platform}/${p.mediaType ?? '?'} ${date} eng=${eng} reach=${reach ?? '?'}]`,
    cap ? `caption: ${cap}` : null,
    desc ? `media: ${desc}` : null,
  ]
    .filter(Boolean)
    .join('\n');
}

function fmtSignals(signals: ContentSignals, platform: string): string {
  const mix = signals.contentMix;
  const reelPct = (mix.reelShare * 100).toFixed(0);
  const top3 = signals.topPosts.slice(0, 3).map((p) => fmtPost(p, platform)).join('\n\n');
  const bottom = signals.bottomPosts.slice(0, 2).map((p) => fmtPost(p, platform)).join('\n\n');
  const bestHour = signals.hourEngagement.find((h) => h.count >= 2);
  const bestDow = signals.dowEngagement[0];
  const dowName = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `
[${platform}] content mix (last 50): ${mix.reels} reels / ${mix.staticImages} static / ${mix.carousels} carousel (reels=${reelPct}%)
[${platform}] days since last post: ${signals.daysSinceLastPost ?? '?'}
[${platform}] best hour (UTC): ${bestHour ? `${bestHour.hour}:00 (avg ${(bestHour.avgEngagementBp / 100).toFixed(2)}% over ${bestHour.count} posts)` : 'n/a'}
[${platform}] best day: ${bestDow ? `${dowName[bestDow.dow]} (avg ${(bestDow.avgEngagementBp / 100).toFixed(2)}%)` : 'n/a'}

[${platform}] TOP performers:
${top3 || '(no posts)'}

[${platform}] BOTTOM performers (for contrast):
${bottom || '(skipped, too few posts)'}
`.trim();
}

function fmtMetrics(rows: SocialMetricsDailyRow[]): string {
  if (rows.length === 0) return 'no metrics yet';
  const newest = rows[0];
  const thirty = rows.find((r) => Date.now() - new Date(r.day).getTime() > 25 * 86_400 * 1000);
  const ninety = rows[rows.length - 1];
  return [
    `today followers=${newest.followers ?? '?'}`,
    thirty ? `30d ago followers=${thirty.followers ?? '?'}` : null,
    ninety && ninety !== newest ? `90d ago followers=${ninety.followers ?? '?'}` : null,
    newest.reach28d !== null
      ? `reach 28d=${newest.reach28d ?? '?'}, impressions 28d=${newest.impressions28d ?? '?'}`
      : null,
  ]
    .filter(Boolean)
    .join('\n');
}

const SYSTEM_PROMPT = `You are a brutally honest social-media strategist for
creators and small brands. Your job: surface 4-5 SPECIFIC, ACTIONABLE
insights from the data below. Generic advice is worthless, every claim must
cite a real number from the input.

Reality check for 2026:
- Reels / short-form video are 80-95% of meaningful reach. If the account
  posts mostly reels, focus advice on reel patterns: hook strength,
  cover-frame readability, format consistency, saves/shares ratio, cadence.
- Saves and shares matter more than likes for algorithm pickup.
- view_count / follower_count > 1.0 means the algo pushed the post past
  the account's own audience. < 0.3 means the algo throttled.
- Static carousels still work for announcements; don't default-recommend.
- "Days since last post" > 7 hits algo reach hard, especially TikTok.

If a brand voice brief is provided, judge whether the captions actually
sound like it and call out drift.

OUTPUT JSON ONLY, an array of 4-5 insights. Each insight:
{
  "title": "short headline, ~6 words",
  "finding": "one specific fact tied to data (cite numbers + dates)",
  "evidence": "what data point(s) prove this, short, concrete",
  "recommendation": "one concrete action to take this week",
  "priority": "high" | "medium" | "low",
  "platform": "instagram" | "tiktok" | "facebook" | "cross"
}

No prose outside the JSON. No backticks. No explanations.`;

export async function regenerateAudit(
  userId: string,
  userName?: string | null
): Promise<{ insights: SocialInsight[]; cached: boolean }> {
  const data = await gatherAuditInputs(userId);
  if (data.connections.length === 0) {
    return { insights: [], cached: false };
  }

  const allPosts = Object.values(data.postsByConnection).flat();
  const latestPostedAt = allPosts.reduce((max, p) => Math.max(max, p.postedAt.getTime()), 0);
  const allMetrics = Object.values(data.metricsByConnection).flat();
  const newestMetric = allMetrics.sort((a, b) => (a.day < b.day ? 1 : -1))[0];
  const followers30d =
    allMetrics.find((m) => Date.now() - new Date(m.day).getTime() > 25 * 86_400 * 1000)
      ?.followers ?? null;

  const totalReels = Object.values(data.signalsByConnection).reduce(
    (s, sig) => s + sig.contentMix.reels,
    0
  );
  const totalPosts = allPosts.length;
  const reelShareBp = totalPosts ? Math.round((totalReels / totalPosts) * 10_000) : 0;

  const inputsHash = buildInputsHash({
    postsLatestPostedAt: latestPostedAt,
    postsCount: totalPosts,
    followers: newestMetric?.followers ?? null,
    followers30dAgo: followers30d,
    reelShareBp,
  });

  const [cached] = await db
    .select()
    .from(socialAudits)
    .where(and(eq(socialAudits.userId, userId), eq(socialAudits.inputsHash, inputsHash)))
    .limit(1);
  if (cached && Date.now() - cached.generatedAt.getTime() < MAX_AUDIT_AGE_MS) {
    return { insights: cached.insights as SocialInsight[], cached: true };
  }

  const [queue] = await db
    .select({ brandVoice: socialQueues.brandVoice })
    .from(socialQueues)
    .where(eq(socialQueues.userId, userId))
    .limit(1);

  const platformsBlock = data.connections
    .map((conn) => {
      const signals = data.signalsByConnection[conn.id];
      const metrics = data.metricsByConnection[conn.id];
      return `${fmtSignals(signals, conn.platform)}\n[${conn.platform}] account state: ${fmtMetrics(metrics)}`;
    })
    .join('\n\n========\n\n');

  const userPrompt = `
Account: ${userName ?? '(unnamed)'}
Today: ${new Date().toISOString().slice(0, 10)}
Brand voice brief: ${queue?.brandVoice ?? '(none set)'}

Per-platform data:
${platformsBlock}

Generate 4-5 insights. JSON only.`.trim();

  const res = await createMessage({
    model: HAIKU_MODEL,
    max_tokens: 2000,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const text = res.content
    .map((c) => (c.type === 'text' ? c.text : ''))
    .join('\n')
    .trim();

  let insights: SocialInsight[] = [];
  try {
    const start = text.indexOf('[');
    const end = text.lastIndexOf(']');
    if (start < 0 || end < 0) throw new Error('no JSON array in response');
    insights = JSON.parse(text.slice(start, end + 1));
  } catch (err) {
    console.error('[social:audit] JSON parse failed:', err, 'raw:', text.slice(0, 500));
    throw new Error('Audit generation returned malformed output');
  }

  await db
    .insert(socialAudits)
    .values({
      userId,
      inputsHash,
      insights: insights as unknown as Record<string, unknown>,
      model: HAIKU_MODEL,
      inputTokens: res.usage?.input_tokens ?? null,
      outputTokens: res.usage?.output_tokens ?? null,
    })
    .onConflictDoUpdate({
      target: [socialAudits.userId, socialAudits.inputsHash],
      set: {
        insights: insights as unknown as Record<string, unknown>,
        model: HAIKU_MODEL,
        inputTokens: res.usage?.input_tokens ?? null,
        outputTokens: res.usage?.output_tokens ?? null,
      },
    });

  return { insights, cached: false };
}

export async function getLatestAudit(userId: string): Promise<{
  insights: SocialInsight[];
  generatedAt: Date | null;
} | null> {
  const [row] = await db
    .select()
    .from(socialAudits)
    .where(eq(socialAudits.userId, userId))
    .orderBy(desc(socialAudits.generatedAt))
    .limit(1);
  if (!row) return null;
  return { insights: row.insights as SocialInsight[], generatedAt: row.generatedAt };
}
