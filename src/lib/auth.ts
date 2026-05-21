import { betterAuth } from 'better-auth';
import { drizzleAdapter } from 'better-auth/adapters/drizzle';
import { db } from '../db';
import * as authSchema from '../db/schema/auth';
import { e } from './env';

/**
 * Server-side Better-Auth instance.
 * Mounted at /api/auth/[...all] via the catch-all route.
 */
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: 'pg',
    schema: authSchema,
    usePlural: false,
  }),

  baseURL: e('BETTER_AUTH_URL') || e('PUBLIC_APP_URL'),
  secret: e('BETTER_AUTH_SECRET'),

  emailAndPassword: {
    enabled: true,
    requireEmailVerification: false,
    minPasswordLength: 8,
    autoSignIn: true,
    sendResetPassword: async ({ user, url }) => {
      const { sendPasswordResetEmail } = await import('./resend');
      await sendPasswordResetEmail({ to: user.email, resetUrl: url });
    },
  },

  // Conditionally register social providers — only when their env vars are
  // populated. Otherwise Better-Auth tries to OAuth with empty creds and the
  // social sign-in endpoint returns 500.
  socialProviders: {
    ...(e('GOOGLE_CLIENT_ID') && e('GOOGLE_CLIENT_SECRET')
      ? {
          google: {
            clientId: e('GOOGLE_CLIENT_ID'),
            clientSecret: e('GOOGLE_CLIENT_SECRET'),
          },
        }
      : {}),
    // Apple Sign In — requires a Services ID (clientId) and a signed JWT
    // (clientSecret) generated from the Apple .p8 private key. Use
    // `node scripts/generate-apple-jwt.mjs` to refresh the JWT every 6 months.
    ...(e('APPLE_CLIENT_ID') && e('APPLE_CLIENT_SECRET')
      ? {
          apple: {
            clientId: e('APPLE_CLIENT_ID'),
            clientSecret: e('APPLE_CLIENT_SECRET'),
            // appBundleIdentifier is required for native iOS app sign-in;
            // can stay omitted for web-only flows.
            ...(e('APPLE_APP_BUNDLE_ID') ? { appBundleIdentifier: e('APPLE_APP_BUNDLE_ID') } : {}),
          },
        }
      : {}),
  },

  user: {
    deleteUser: { enabled: true },
  },

  databaseHooks: {
    user: {
      create: {
        after: async (createdUser, ctx) => {
          // 1) Mirror into the `public.users` profile table so existing
          //    `.from('users')` API code keeps working transparently.
          // 2) Attribute referral code if present in the ref_code cookie.
          try {
            const { sql } = await import('../db');
            await sql`
              INSERT INTO public.users (id, email, name)
              VALUES (${createdUser.id}, ${createdUser.email}, ${createdUser.name ?? null})
              ON CONFLICT (id) DO NOTHING
            `;
          } catch (err) {
            console.warn('[auth] public.users mirror insert failed:', err);
          }

          try {
            const cookieHeader = ctx?.context?.request?.headers?.get?.('cookie') ?? '';
            const refCookie = cookieHeader
              .split(';')
              .map((c: string) => c.trim())
              .find((c: string) => c.startsWith('ref_code='));
            const refCode = refCookie ? decodeURIComponent(refCookie.split('=')[1] ?? '') : '';
            if (refCode && /^[a-z0-9]{4,16}$/i.test(refCode)) {
              const { recordReferral } = await import('./referral');
              const ip =
                ctx?.context?.request?.headers?.get?.('x-real-ip') ??
                ctx?.context?.request?.headers?.get?.('x-forwarded-for')?.split(',')[0]?.trim() ??
                'unknown';
              await recordReferral(createdUser.id, refCode, ip);
            }
          } catch (err) {
            console.warn('[auth] post-create referral hook failed:', err);
          }

          // 3) Welcome email — fire-and-forget so a Resend hiccup never blocks signup.
          try {
            const { sendWelcomeEmail } = await import('./resend');
            await sendWelcomeEmail({
              to: createdUser.email,
              name: createdUser.name ?? undefined,
              userId: createdUser.id,
            });
          } catch (err) {
            console.warn('[auth] welcome email failed:', err);
          }
        },
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 30, // 30 days
    updateAge: 60 * 60 * 24,       // refresh once per day
    cookieCache: { enabled: true, maxAge: 60 * 5 },
  },

  trustedOrigins: [
    e('BETTER_AUTH_URL') || 'http://localhost:4321',
    e('PUBLIC_APP_URL') || 'https://www.grappes.dev',
    'https://grappes.dev',
    'https://www.grappes.dev',
  ].filter(Boolean),

  advanced: {
    cookiePrefix: 'grappes',
    useSecureCookies: (e('PUBLIC_APP_URL') || '').startsWith('https://'),
    // Skip Origin check for paths where it causes false rejections without
    // adding real security. Cause: cross-origin redirects (apex → www on
    // Vercel) make the browser set Origin = 'null', so Better-Auth throws
    // MISSING_OR_NULL_ORIGIN.
    //
    // - /sign-out: low-risk, worst-case CSRF = unwanted logout.
    // - /sign-in/social: just returns the OAuth provider's authorize URL.
    //   The CSRF protection in OAuth flows lives in the `state` parameter
    //   that's validated on the /callback/* endpoint.
    // - /callback/* (esp. /callback/apple): Apple delivers the OAuth response
    //   via form_post POST with NO Origin header (it's a top-level browser
    //   navigation from apple.com — Origin gets stripped on cross-origin
    //   form posts). The OAuth `state` cookie still provides CSRF protection.
    //
    // Note: Better-Auth's runtime accepts string[] for path-prefix skipping
    // (see api/middlewares/origin-check.mjs) but the published type only
    // declares boolean — hence the cast.
    disableOriginCheck: ['/sign-out', '/sign-in/social', '/callback'] as unknown as boolean,
    // Force UUID v4 for all Better-Auth ids. The drizzle schema uses
    // Postgres `uuid` columns, so the default nanoid-style generator fails
    // with "invalid input syntax for type uuid".
    database: {
      generateId: () => crypto.randomUUID(),
    },
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
