import type { APIRoute } from 'astro';
import { createAuthClient } from '@lib/supabase';

export const GET: APIRoute = async ({ request, cookies }) => {
  const supabase = createAuthClient(request, cookies);

  const appUrl = import.meta.env.PUBLIC_APP_URL?.replace(/\/$/, '') || 'https://grappes.dev';

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: `${appUrl}/api/auth/callback`,
      skipBrowserRedirect: true,
    },
  });

  if (error || !data.url) {
    return new Response(null, { status: 302, headers: { Location: '/sign-in?error=oauth' } });
  }

  return new Response(null, { status: 302, headers: { Location: data.url } });
};
