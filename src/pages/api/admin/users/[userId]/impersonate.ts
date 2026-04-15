// POST /api/admin/users/[userId]/impersonate
// Generates a Supabase Auth magic link for the user and returns it to the admin,
// who can open it in an incognito tab to sign in as that user (for debugging).
// We DON'T auto-redirect — giving a clickable URL prevents foot-gun mistakes.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { json } from '../../../../../lib/api-utils';

export const POST: APIRoute = async ({ cookies, params }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  const client = createAdminClient();
  const { data: user } = await client.from('users').select('email').eq('id', userId).maybeSingle();
  if (!user?.email) return json({ error: 'User not found or email missing' }, 404);

  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';
  const { data, error } = await client.auth.admin.generateLink({
    type: 'magiclink',
    email: user.email,
    options: { redirectTo: `${siteUrl}/dashboard` },
  });
  if (error) return json({ error: error.message }, 500);

  // action_link is the one-click URL
  const link = (data as any)?.properties?.action_link || (data as any)?.action_link || null;
  if (!link) return json({ error: 'Could not generate magic link' }, 500);
  return json({ ok: true, email: user.email, url: link });
};
