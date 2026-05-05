import { createAuthClient } from 'better-auth/client';

/**
 * Browser-side Better-Auth client.
 * Used in <script> islands (dashboard buttons, account page).
 */
export const authClient = createAuthClient({
  baseURL: typeof window !== 'undefined' ? window.location.origin : undefined,
});

export const { signIn, signUp, signOut, useSession, getSession } = authClient;
