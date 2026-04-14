import type { APIRoute } from 'astro';
import { createAuthClient } from '@lib/supabase';
import { createAdminClient } from '../../../lib/supabase';
import { recordReferral } from '../../../lib/referral';

export const GET: APIRoute = async ({ request, cookies, redirect }) => {
  const url = new URL(request.url);
  const code = url.searchParams.get('code');

  if (!code) {
    return redirect('/sign-in');
  }

  const supabase = createAuthClient(request, cookies);
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);

  if (error) {
    return redirect('/sign-in');
  }

  // Ensure user profile exists (fallback if DB trigger missed)
  if (data.user?.id) {
    try {
      const admin = createAdminClient();
      await admin.from('users').upsert({
        id: data.user.id,
        email: data.user.email ?? '',
        name: data.user.user_metadata?.full_name ?? data.user.user_metadata?.name ?? null,
      }, { onConflict: 'id', ignoreDuplicates: true });
    } catch (e) {
      console.warn('[auth/callback] User profile upsert failed:', e);
    }
  }

  // Track referral for OAuth sign-ups
  const refCode = cookies.get('ref_code')?.value ?? '';
  if (refCode && data.user?.id) {
    const signupIp = request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown';
    try {
      await recordReferral(data.user.id, refCode, signupIp);
      cookies.delete('ref_code', { path: '/' });
    } catch (e) {
      console.warn('[auth/callback] Referral recording failed:', e);
    }
  }

  // First-time users (no projects yet) → drop into project creation
  if (data.user?.id) {
    try {
      const admin = createAdminClient();
      const { count } = await admin
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', data.user.id);
      if ((count ?? 0) === 0) return redirect('/dashboard/new');
    } catch (e) {
      console.warn('[auth/callback] project-count check failed:', e);
    }
  }

  return redirect('/dashboard');
};
