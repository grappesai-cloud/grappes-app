import { defineMiddleware } from 'astro:middleware';
import { createAuthClient } from './lib/supabase';
import { checkRateLimit, getClientIp } from './lib/rate-limit';

/** Routes that render without any auth/DB dependency. */
const PUBLIC_PATHS = new Set<string>([
  '/',
  '/terms',
  '/privacy',
  '/sign-in',
  '/sign-up',
  '/forgot-password',
  '/reset-password',
  '/404',
  '/500',
  '/sitemap.xml',
  '/robots.txt',
  '/api/health',
]);

const PUBLIC_PREFIXES = [
  '/assets/',
  '/_astro/',
  '/favicon',
];

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function hasSupabaseConfig(): boolean {
  const url = import.meta.env.PUBLIC_SUPABASE_URL || (typeof process !== 'undefined' ? process.env.PUBLIC_SUPABASE_URL : '');
  const key = import.meta.env.PUBLIC_SUPABASE_ANON_KEY || (typeof process !== 'undefined' ? process.env.PUBLIC_SUPABASE_ANON_KEY : '');
  return !!(url && key && !url.includes('placeholder') && !key.includes('placeholder'));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  // Graceful bypass: if Supabase isn't configured yet (e.g. local dev without .env),
  // let public routes render without touching Supabase. Protected routes get a helpful 503.
  if (!hasSupabaseConfig()) {
    if (isPublic(path)) {
      context.locals.supabase = null as any;
      context.locals.user = null as any;
      return next();
    }
    // Protected route but no config — return a clear diagnostic instead of crashing.
    return new Response(
      JSON.stringify({
        error: 'Supabase is not configured',
        hint: 'Set PUBLIC_SUPABASE_URL and PUBLIC_SUPABASE_ANON_KEY in your .env file. See SETUP-GRAPPES.md.',
        path,
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const supabase = createAuthClient(context.request, context.cookies);
  const { data: { user } } = await supabase.auth.getUser();

  context.locals.supabase = supabase;
  context.locals.user = user;

  // Track ?ref=CODE in a 30-day cookie for referral attribution
  const refCode = context.url.searchParams.get('ref');
  if (refCode && /^[a-z0-9]{4,16}$/i.test(refCode)) {
    context.cookies.set('ref_code', refCode.toLowerCase(), {
      path: '/',
      maxAge: 60 * 60 * 24 * 30, // 30 days
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
    });
  }

  if (context.url.pathname.startsWith('/dashboard') && !user) {
    return context.redirect('/sign-in');
  }

  // CSRF protection: verify Origin header on state-changing requests.
  // Public endpoints (webhooks, analytics, forms) are excluded — they use their own auth.
  if (
    context.request.method === 'POST' ||
    context.request.method === 'PATCH' ||
    context.request.method === 'DELETE'
  ) {
    const origin = context.request.headers.get('origin');
    const isPublicEndpoint =
      path.startsWith('/api/webhooks/') ||
      path.startsWith('/api/analytics/') ||
      path.startsWith('/api/forms/') ||
      path.startsWith('/api/auth/') ||
      path === '/sign-up' ||
      path === '/sign-in' ||
      path === '/forgot-password' ||
      path === '/reset-password';

    if (origin && !isPublicEndpoint) {
      const requestOrigin = new URL(context.url).origin;
      const configuredOrigin = (import.meta.env.PUBLIC_SITE_URL || import.meta.env.SITE || '').replace(/\/$/, '');
      const appOrigin = (import.meta.env.PUBLIC_APP_URL || '').replace(/\/$/, '');
      const allowed = new Set([requestOrigin, configuredOrigin, appOrigin].filter(Boolean));
      if (!allowed.has(origin)) {
        return new Response(JSON.stringify({ error: 'CSRF: origin mismatch' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  // Global per-IP rate limit on all API requests (100 req/min)
  if (path.startsWith('/api/')) {
    const ip = getClientIp(context.request);
    if (!checkRateLimit(`global:ip:${ip}`, 100, 60_000)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Guard API routes that require authentication (each handler also checks,
  // but this provides defence-in-depth against missing per-handler checks).
  if (
    path.startsWith('/api/') &&
    !user &&
    !path.startsWith('/api/webhooks/') &&
    !path.startsWith('/api/analytics/') &&
    !path.startsWith('/api/forms/') &&
    !path.startsWith('/api/auth/') &&
    !path.startsWith('/api/cron/') &&
    !path.startsWith('/api/domains/check') &&
    !path.startsWith('/api/admin/') &&
    path !== '/api/health'
  ) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return next();
});
