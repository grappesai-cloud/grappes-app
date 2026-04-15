// ─── Password Changed Notification ───────────────────────────────────────────
// Called client-side after a successful password update on /reset-password.
// Sends a confirmation email so the user knows their password was changed.

import type { APIRoute } from 'astro';
import { createAuthClient } from '../../../lib/supabase';
import { sendPasswordChangedEmail } from '../../../lib/resend';

export const POST: APIRoute = async ({ request, cookies }) => {
  try {
    const supabase = createAuthClient(request, cookies);
    const { data: { user } } = await supabase.auth.getUser();

    if (!user?.email) {
      return new Response(JSON.stringify({ error: 'Not authenticated' }), { status: 401 });
    }

    const result = await sendPasswordChangedEmail({ to: user.email });

    return new Response(JSON.stringify({ success: result.success }), {
      status: result.success ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e: any) {
    console.error('[password-changed] Error:', e);
    return new Response(JSON.stringify({ error: 'Internal error' }), { status: 500 });
  }
};
