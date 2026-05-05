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

  socialProviders: {
    google: {
      clientId: e('GOOGLE_CLIENT_ID'),
      clientSecret: e('GOOGLE_CLIENT_SECRET'),
    },
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
  },
});

export type Session = typeof auth.$Infer.Session;
export type User = typeof auth.$Infer.Session.user;
