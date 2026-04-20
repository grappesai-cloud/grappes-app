// Haiku-powered reply suggestions for the admin support UI.
// POST /api/admin/support/:threadId/suggest → { suggestions: string[] }
// Haiku reads the thread history + user context and proposes 3 short
// candidate replies the admin can pick from and edit before sending.

import type { APIRoute } from 'astro';
import { timingSafeEqual, createHmac } from 'node:crypto';
import { createAdminClient } from '../../../../../lib/supabase';
import { db } from '../../../../../lib/db';
import { createMessage, HAIKU_MODEL } from '../../../../../lib/anthropic';
import { json } from '../../../../../lib/api-utils';

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

export const POST: APIRoute = async ({ cookies, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value ?? '')) {
    return json({ error: 'Forbidden' }, 403);
  }
  const threadId = params.threadId;
  if (!threadId) return json({ error: 'Missing threadId' }, 400);

  const client = createAdminClient();
  const { data: thread } = await client
    .from('support_threads').select('*').eq('id', threadId).maybeSingle();
  if (!thread) return json({ error: 'Thread not found' }, 404);

  // Pull context: user profile + latest project + brief + conversation history
  const [user, projectFull, brief, messages] = await Promise.all([
    db.users.findById(thread.user_id),
    thread.project_id ? db.projects.findById(thread.project_id) : Promise.resolve(null),
    thread.project_id ? db.briefs.findByProjectId(thread.project_id) : Promise.resolve(null),
    client
      .from('support_messages')
      .select('sender, content, created_at')
      .eq('thread_id', threadId)
      .order('created_at', { ascending: true }),
  ]);

  const history = (messages.data ?? [])
    .map(m => `${m.sender === 'user' ? 'User' : 'Admin'}: ${m.content}`)
    .join('\n');

  const ctxLines: string[] = [];
  if (user) {
    ctxLines.push(`Name: ${user.name ?? '(unknown)'}`);
    ctxLines.push(`Email: ${user.email}`);
    ctxLines.push(`Plan: ${user.plan ?? 'free'}`);
  }
  if (projectFull) {
    ctxLines.push(`Project: ${projectFull.name} (status: ${projectFull.status}, billing: ${projectFull.billing_status ?? 'free'})`);
  }
  if (brief?.data?.business?.industry) ctxLines.push(`Industry: ${brief.data.business.industry}`);
  const context = ctxLines.join('\n');

  const systemPrompt = `You are a customer support assistant for Grappes, an AI website builder.
Your job: read a conversation between a USER and the Grappes ADMIN, then propose 3 SHORT reply options the admin could send.

Rules:
- 3 options, each 1-3 sentences MAX.
- Tone: warm, direct, professional. Match the user's language (English or Romanian — infer from their messages).
- Do NOT make up product features. We currently offer: AI-generated websites, contact/newsletter forms, per-site activation (annual/lifetime), Creative Direction (human + AI finish), referral program, custom domains. We do NOT have: blog CMS, e-commerce, booking calendar, event publishing.
- If the user asks about pricing: Annual €99/yr, Lifetime €399 (one-time), Creative Direction from €949/yr. Free trial is 7 days, after which the site shows an expired page until renewed.
- If the user reports a bug: first option should acknowledge and ask for steps to reproduce. Second should offer to investigate. Third can propose a workaround.
- If the user asks "how do I X?": first option explains the step-by-step, second offers to do it for them, third asks a clarifying question.
- Never promise timelines for features we don't have.

Output STRICT JSON with no extra text:
{"suggestions":["option 1","option 2","option 3"]}`;

  const userPrompt = `USER CONTEXT:\n${context || '(no context)'}\n\nCONVERSATION:\n${history || '(empty)'}\n\nPropose 3 replies.`;

  try {
    const resp = await createMessage({
      model: HAIKU_MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    });
    const raw = resp.content[0]?.type === 'text' ? resp.content[0].text : '';
    // Try to parse JSON — Haiku sometimes wraps in code fence
    const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/i, '').trim();
    let parsed: any;
    try { parsed = JSON.parse(cleaned); } catch {
      // Fallback: extract the first {...} block
      const m = cleaned.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : { suggestions: [] };
    }
    const suggestions = Array.isArray(parsed?.suggestions)
      ? parsed.suggestions.map((s: any) => String(s)).slice(0, 5)
      : [];
    return json({ ok: true, suggestions });
  } catch (e: any) {
    console.error('[admin/support/suggest] Haiku failed:', e);
    return json({ error: `Suggestion engine failed: ${e?.message ?? 'unknown'}` }, 500);
  }
};
