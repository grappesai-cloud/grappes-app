import { defineMiddleware } from 'astro:middleware';
import { auth } from './lib/auth';
import { createAuthClient } from './lib/supabase';
import { checkRateLimit, getClientIp } from './lib/rate-limit';
import { e } from './lib/env';

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
  '/kit/',  // published press kits — anyone with the slug can view
];

function isPublic(path: string): boolean {
  if (PUBLIC_PATHS.has(path)) return true;
  for (const prefix of PUBLIC_PREFIXES) {
    if (path.startsWith(prefix)) return true;
  }
  return false;
}

function hasAuthConfig(): boolean {
  const dbUrl = e('DATABASE_URL');
  const secret = e('BETTER_AUTH_SECRET');
  return !!(dbUrl && secret && !dbUrl.includes('placeholder'));
}

export const onRequest = defineMiddleware(async (context, next) => {
  const path = context.url.pathname;

  // Graceful bypass for unconfigured local dev.
  if (!hasAuthConfig()) {
    if (isPublic(path)) {
      context.locals.user = null;
      context.locals.session = null;
      context.locals.supabase = createAuthClient();
      return next();
    }
    return new Response(
      JSON.stringify({
        error: 'Auth/DB not configured',
        hint: 'Set DATABASE_URL and BETTER_AUTH_SECRET in your .env file. See SETUP-GRAPPES.md.',
        path,
      }),
      { status: 503, headers: { 'Content-Type': 'application/json' } }
    );
  }

  const sessionData = await auth.api.getSession({ headers: context.request.headers }).catch(() => null);
  const user = sessionData?.user ?? null;
  const session = sessionData?.session ?? null;

  context.locals.user = user;
  context.locals.session = session;
  context.locals.supabase = createAuthClient(context.request, context.cookies);

  // Track ?ref=CODE in a 30-day cookie for referral attribution
  const refCode = context.url.searchParams.get('ref');
  if (refCode && /^[a-z0-9]{4,16}$/i.test(refCode)) {
    context.cookies.set('ref_code', refCode.toLowerCase(), {
      path: '/',
      maxAge: 60 * 60 * 24 * 30,
      httpOnly: true,
      sameSite: 'lax',
      secure: import.meta.env.PROD,
    });
  }

  if (
    (context.url.pathname.startsWith('/dashboard') || context.url.pathname.startsWith('/soc2')) &&
    !user
  ) {
    return context.redirect('/sign-in');
  }

  // CSRF protection on state-changing requests.
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

    if (!isPublicEndpoint) {
      if (!origin) {
        return new Response(JSON.stringify({ error: 'CSRF: missing origin header' }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        });
      }
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

  // Per-IP rate limit on all API requests (100 req/min)
  if (path.startsWith('/api/')) {
    const ip = getClientIp(context.request);
    if (!checkRateLimit(`global:ip:${ip}`, 100, 60_000)) {
      return new Response(JSON.stringify({ error: 'Too many requests' }), {
        status: 429,
        headers: { 'Content-Type': 'application/json' },
      });
    }
  }

  // Mockup composite endpoint enforces its own owner/published check at the
  // route handler. Don't block here so the public /kit/<slug> page can embed
  // the rendered JPEGs without auth.
  const isPublicMockup = /^\/api\/kits\/[0-9a-f-]{36}\/mockup\/[a-z_]+$/.test(path);

  // Guard authenticated API routes (defence-in-depth).
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
    !isPublicMockup &&
    path !== '/api/health' &&
    path !== '/api/contact'
  ) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return next();
});
