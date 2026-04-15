// User-facing support chat endpoint.
//   GET  /api/support/messages       → { thread, messages }
//   POST /api/support/messages { content } → append user message, email admin

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { db } from '../../../lib/db';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';
import { sendPlatformEmailInternal } from '../../../lib/resend';
import { json } from '../../../lib/api-utils';

const ADMIN_EMAIL = import.meta.env.ADMIN_EMAIL ?? 'grappes.ai@gmail.com';
const SITE_URL    = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

async function getOrCreateOpenThread(userId: string, projectId?: string | null) {
  const client = createAdminClient();
  const { data: existing } = await client
    .from('support_threads')
    .select('*')
    .eq('user_id', userId)
    .eq('status', 'open')
    .order('last_message_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (existing) return existing;
  const { data: created, error } = await client
    .from('support_threads')
    .insert({ user_id: userId, project_id: projectId ?? null })
    .select('*')
    .single();
  if (error) throw error;
  return created;
}

export const GET: APIRoute = async ({ locals, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const client = createAdminClient();
  const projectId = url.searchParams.get('projectId');
  const thread = await getOrCreateOpenThread(user.id, projectId);

  const { data: messages } = await client
    .from('support_messages')
    .select('id, sender, content, created_at')
    .eq('thread_id', thread.id)
    .order('created_at', { ascending: true });

  // Mark thread read for user (they just fetched)
  if (thread.unread_for_user) {
    await client
      .from('support_threads')
      .update({ unread_for_user: false })
      .eq('id', thread.id);
  }

  return json({
    ok: true,
    thread: { id: thread.id, status: thread.status, unread: thread.unread_for_user },
    messages: messages ?? [],
  });
};

export const POST: APIRoute = async ({ locals, request, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const ip = getClientIp(request);
  // 10 support messages / user / hour (abuse guard — real support rarely needs this much)
  if (!checkRateLimit(`support:user:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'You are sending messages too fast. Please slow down.' }, 429);
  }
  // 50 messages / IP / hour (catches a single abuser across accounts)
  if (!checkRateLimit(`support:ip:${ip}`, 50, 3_600_000)) {
    return json({ error: 'Rate limited' }, 429);
  }

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const content = (body?.content ?? '').toString().trim().slice(0, 4000);
  const projectId = (body?.projectId ?? url.searchParams.get('projectId') ?? null) as string | null;
  if (!content) return json({ error: 'Message required' }, 400);

  const client = createAdminClient();
  const thread = await getOrCreateOpenThread(user.id, projectId);

  const now = new Date().toISOString();
  const { data: message, error } = await client
    .from('support_messages')
    .insert({ thread_id: thread.id, sender: 'user', content })
    .select('id, sender, content, created_at')
    .single();
  if (error) return json({ error: error.message }, 500);

  await client
    .from('support_threads')
    .update({ last_message_at: now, unread_for_admin: true, unread_for_user: false })
    .eq('id', thread.id);

  // Email the admin — non-fatal if Resend fails
  try {
    const dbUser = await db.users.findById(user.id);
    const userEmail = dbUser?.email ?? user.email ?? 'unknown';
    const userName  = dbUser?.name ?? userEmail.split('@')[0];
    const adminLink = `${SITE_URL}/admin/support/${thread.id}`;
    const safeContent = content.replace(/</g, '&lt;').replace(/\n/g, '<br>');
    const html = `
      <div style="font-family:-apple-system,'DM Sans',sans-serif;color:#222;max-width:560px;">
        <h2 style="margin:0 0 12px;font-size:18px;">New support message</h2>
        <p style="color:#666;font-size:13px;margin:0 0 18px;">From <strong>${userName}</strong> &lt;${userEmail}&gt;</p>
        <div style="background:#f6f7fa;border-left:3px solid #06bfdd;padding:12px 16px;border-radius:4px;margin:14px 0;">${safeContent}</div>
        <p style="margin:20px 0;"><a href="${adminLink}" style="background:#06bfdd;color:#0a0a0a;padding:10px 20px;border-radius:999px;font-weight:600;text-decoration:none;">Reply in admin →</a></p>
        <p style="font-size:12px;color:#999;">Thread ID: ${thread.id}</p>
      </div>`;
    await sendPlatformEmailInternal({
      to: ADMIN_EMAIL,
      subject: `[Grappes Support] ${userName}: ${content.slice(0, 60)}${content.length > 60 ? '…' : ''}`,
      html,
    });
  } catch (e) {
    console.warn('[support] Admin notification email failed (non-fatal):', e);
  }

  return json({ ok: true, message, thread: { id: thread.id } }, 201);
};
