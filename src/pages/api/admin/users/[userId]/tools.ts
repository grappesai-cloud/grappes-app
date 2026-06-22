// ── POST /api/admin/users/[userId]/tools { tools: string[] | null } ───────────
// Set a user's tool allowlist. `null` (or omitted) restores full access;
// an array restricts to those tool keys ([] = no tools). See src/lib/tools.ts.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { sanitizeTools } from '../../../../../lib/tools';
import { json } from '../../../../../lib/api-utils';

export const POST: APIRoute = async ({ cookies, request, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  // null/undefined → full access (NULL column); array → explicit allowlist.
  const value = body?.tools == null ? null : sanitizeTools(body.tools);

  const client = createAdminClient();
  const { data: current } = await client.from('users').select('id').eq('id', userId).maybeSingle();
  if (!current) return json({ error: 'User not found' }, 404);

  const { error } = await client.from('users').update({ allowed_tools: value }).eq('id', userId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, allowed_tools: value });
};
