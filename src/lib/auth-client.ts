import { createAuthClient } from 'better-auth/client';

/**
 * Browser-side Better-Auth client.
 * Used in <script> islands (sign-in, sign-up, dashboard buttons).
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
});

export const {
  signIn,
  signUp,
  signOut,
  useSession,
  getSession,
  forgetPassword,
  resetPassword,
  changePassword,
} = authClient;
