// One-time admin endpoint: sets a user's plan to 'owner' (unlimited edits)
// Protected by ADMIN_SECRET env var
import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';

export const POST: APIRoute = async ({ request }) => {
  // 10 admin requests/hour per IP
  if (!checkRateLimit(`admin:${getClientIp(request)}`, 10, 3_600_000)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
  }

  const secret      = request.headers.get('x-admin-secret') ?? '';
  const adminSecret = import.meta.env.ADMIN_SECRET ?? '';
  const allowed = adminSecret !== '' && (() => {
    try { return timingSafeEqual(Buffer.from(secret), Buffer.from(adminSecret)); } catch { return false; }
  })();
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Forbidden' }), { status: 403 });
  }

  let body: any;
  try { body = await request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400 }); }
  const { email } = body;
  if (!email) return new Response(JSON.stringify({ error: 'email required' }), { status: 400 });

  const client = createAdminClient();

  // Find user by email in users table
  const { data: userData, error: authErr } = await client
    .from('users')
    .select('id')
    .eq('email', email)
    .single();
  if (authErr || !userData) {
    if (authErr) console.error('[admin/set-owner] Lookup error:', authErr);
    return new Response(JSON.stringify({ error: 'User not found' }), { status: 404 });
  }

  const userId = userData.id;

  // Update plan to owner + reset edits_used + clear extra_edits
  const { error: updateErr } = await client
    .from('users')
    .update({ plan: 'owner', edits_used: 0, extra_edits: 0, edits_period_start: new Date().toISOString() })
    .eq('id', userId);

  if (updateErr) {
    console.error('[admin/set-owner] Update error:', updateErr);
    return new Response(JSON.stringify({ error: 'Update failed' }), { status: 500 });
  }

  return new Response(JSON.stringify({ ok: true, userId, plan: 'owner' }), { status: 200 });
};
