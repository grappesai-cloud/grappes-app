// POST /api/admin/users/[userId]/impersonate
//
// Originally generated a Supabase Auth magic link the admin could open to
// sign in as the target user. Better-Auth has no first-party equivalent
// (would need the admin plugin), so this now triggers a password-reset
// email on the target user's behalf — useful when a user has lost access
// or needs help getting back into their account.
//
// The admin button is best relabelled "Send password reset" in the UI.

import type { APIRoute } from 'astro';
import { auth } from '../../../../../lib/auth';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { json } from '../../../../../lib/api-utils';

export const POST: APIRoute = async ({ cookies, params, request }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const userId = params.userId;
  if (!userId) return json({ error: 'missing userId' }, 400);

  const client = createAdminClient();
  const { data: user } = await client.from('users').select('email').eq('id', userId).maybeSingle();
  if (!user?.email) return json({ error: 'User not found or email missing' }, 404);

  try {
    const response: Response = await (auth.api as any).forgetPassword({
      body: { email: user.email, redirectTo: '/reset-password' },
      headers: request.headers,
      asResponse: true,
    });
    if (!response.ok) {
      const text = await response.text();
      return json({ error: `Better-Auth: ${text || response.status}` }, 500);
    }
  } catch (err: any) {
    return json({ error: err?.body?.message || err?.message || 'Failed to send reset email' }, 500);
  }

  return json({
    ok: true,
    email: user.email,
    message: `Password-reset email sent to ${user.email}.`,
  });
};
