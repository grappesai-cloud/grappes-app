import { createClient } from '@supabase/supabase-js';
import { createServerClient, parseCookieHeader } from '@supabase/ssr';
import type { AstroCookies } from 'astro';
import { e } from './env';

/**
 * Auth-aware SSR client.
 * Reads cookies from the Request header (Astro 5 compatible).
 * Writes new/refreshed tokens back via AstroCookies.set().
 */
export function createAuthClient(request: Request, cookies: AstroCookies) {
  return createServerClient(
    e('PUBLIC_SUPABASE_URL'),
    e('PUBLIC_SUPABASE_ANON_KEY'),
    {
      cookies: {
        getAll() {
          return parseCookieHeader(request.headers.get('Cookie') ?? '');
        },
        setAll(cookiesToSet: { name: string; value: string; options: Record<string, unknown> }[]) {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookies.set(name, value, options as Parameters<typeof cookies.set>[2]);
          });
        },
      },
    }
  );
}

/** Admin client with service role key — server-side only, never expose to browser */
export function createAdminClient() {
  return createClient(
    e('PUBLIC_SUPABASE_URL'),
    e('SUPABASE_SERVICE_ROLE_KEY'),
    {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
      },
    }
  );
}
