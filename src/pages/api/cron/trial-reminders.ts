// ─── Cron: send trial reminder emails for free sites nearing expiry ──────────
// Runs daily via Vercel Cron (configured in vercel.json).
// Sends a 3-day reminder and a 1-day final warning to free-tier users.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '../../../lib/supabase';
import { sendTrialReminderEmail, sendTrialFinalWarningEmail } from '../../../lib/resend';

function safeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

export const GET: APIRoute = async ({ request }) => {
  const cronSecret = import.meta.env.CRON_SECRET;
  if (!cronSecret) {
    return new Response('CRON_SECRET not configured', { status: 500 });
  }
  const auth = request.headers.get('authorization') ?? '';
  if (!safeCompare(auth, `Bearer ${cronSecret}`)) {
    return new Response('Unauthorized', { status: 401 });
  }

  const supabase = createAdminClient();
  const now = new Date();

  // ── 3-day reminder: expires_at between 3 and 4 days from now ──────────────
  const from3 = new Date(now.getTime() + 3 * 24 * 60 * 60 * 1000).toISOString();
  const to4   = new Date(now.getTime() + 4 * 24 * 60 * 60 * 1000).toISOString();

  const { data: remind3, error: err3 } = await supabase
    .from('projects')
    .select('id, name, preview_url, expires_at, user_id')
    .eq('billing_status', 'free')
    .gte('expires_at', from3)
    .lt('expires_at', to4)
    .not('expires_at', 'is', null);

  let sent3 = 0;
  if (err3) {
    console.error('[cron/trial-reminders] 3-day query error:', err3);
  } else if (remind3 && remind3.length > 0) {
    for (const p of remind3) {
      try {
        const { data: user } = await supabase
          .from('users')
          .select('email')
          .eq('id', p.user_id)
          .maybeSingle();
        if (user?.email && p.preview_url) {
          await sendTrialReminderEmail({
            to: user.email,
            siteName: p.name ?? 'Site-ul tău',
            siteUrl: p.preview_url,
            daysLeft: 3,
            expiresAt: p.expires_at!,
          });
          sent3++;
        }
      } catch (e) {
        console.error(`[cron/trial-reminders] 3-day email failed for project ${p.id}:`, e);
      }
    }
  }

  // ── 1-day final warning: expires_at between 0 and 1 day from now ──────────
  const from0 = now.toISOString();
  const to1   = new Date(now.getTime() + 1 * 24 * 60 * 60 * 1000).toISOString();

  const { data: remind1, error: err1 } = await supabase
    .from('projects')
    .select('id, name, preview_url, expires_at, user_id')
    .eq('billing_status', 'free')
    .gte('expires_at', from0)
    .lt('expires_at', to1)
    .not('expires_at', 'is', null);

  let sent1 = 0;
  if (err1) {
    console.error('[cron/trial-reminders] 1-day query error:', err1);
  } else if (remind1 && remind1.length > 0) {
    for (const p of remind1) {
      try {
        const { data: user } = await supabase
          .from('users')
          .select('email')
          .eq('id', p.user_id)
          .maybeSingle();
        if (user?.email && p.preview_url) {
          await sendTrialFinalWarningEmail({
            to: user.email,
            siteName: p.name ?? 'Site-ul tău',
            siteUrl: p.preview_url,
            expiresAt: p.expires_at!,
          });
          sent1++;
        }
      } catch (e) {
        console.error(`[cron/trial-reminders] 1-day email failed for project ${p.id}:`, e);
      }
    }
  }

  console.log(`[cron/trial-reminders] Sent ${sent3} 3-day reminders, ${sent1} final warnings`);

  return new Response(JSON.stringify({ sent3dayReminders: sent3, sent1dayWarnings: sent1 }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
