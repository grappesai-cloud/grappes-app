import type { APIRoute } from 'astro';
import { createAuthClient } from '@lib/supabase';
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

  return redirect('/dashboard');
};
