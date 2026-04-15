// Admin posts a reply into a support thread + emails the user.

import type { APIRoute } from 'astro';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { createAdminClient } from '../../../../../lib/supabase';
import { db } from '../../../../../lib/db';
import { sendPlatformEmailInternal } from '../../../../../lib/resend';
import { json } from '../../../../../lib/api-utils';

const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

function verifyAdminSession(token: string): boolean {
  const secret = import.meta.env.ADMIN_SECRET ?? '';
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const nonce = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', secret).update(nonce).digest('hex');
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}

export const POST: APIRoute = async ({ request, cookies, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value ?? '')) {
    return json({ error: 'Forbidden' }, 403);
  }
  const threadId = params.threadId;
  if (!threadId) return json({ error: 'Missing threadId' }, 400);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const content = (body?.content ?? '').toString().trim().slice(0, 4000);
  const closeAfter = body?.closeAfter === true;
  if (!content) return json({ error: 'Message required' }, 400);

  const client = createAdminClient();
  const { data: thread } = await client
    .from('support_threads').select('*').eq('id', threadId).maybeSingle();
  if (!thread) return json({ error: 'Thread not found' }, 404);

  const now = new Date().toISOString();
  const { data: message, error } = await client
    .from('support_messages')
    .insert({ thread_id: threadId, sender: 'admin', content })
    .select('id, sender, content, created_at')
    .single();
  if (error) return json({ error: error.message }, 500);

  await client
    .from('support_threads')
    .update({
      last_message_at: now,
      unread_for_user: true,
      unread_for_admin: false,
      ...(closeAfter ? { status: 'closed' } : {}),
    })
    .eq('id', threadId);

  // Email the user — they might not have the dashboard open
  try {
    const user = await db.users.findById(thread.user_id);
    if (user?.email) {
      const safeContent = content.replace(/</g, '&lt;').replace(/\n/g, '<br>');
      const link = `${SITE_URL}/dashboard?support=1`;
      const html = `
        <div style="font-family:-apple-system,'DM Sans',sans-serif;color:#222;max-width:560px;">
          <h2 style="margin:0 0 12px;font-size:18px;">You have a reply from Grappes support</h2>
          <div style="background:#f6f7fa;border-left:3px solid #06bfdd;padding:12px 16px;border-radius:4px;margin:14px 0;">${safeContent}</div>
          <p style="margin:20px 0;"><a href="${link}" style="background:#06bfdd;color:#0a0a0a;padding:10px 20px;border-radius:999px;font-weight:600;text-decoration:none;">Open chat →</a></p>
          <p style="font-size:12px;color:#999;margin-top:24px;">You can also reply directly in the Grappes app — click the chat bubble in the bottom-right corner.</p>
        </div>`;
      await sendPlatformEmailInternal({
        to: user.email,
        subject: 'New reply from Grappes support',
        html,
      });
    }
  } catch (e) {
    console.warn('[admin/support/reply] user email failed (non-fatal):', e);
  }

  return json({ ok: true, message });
};
