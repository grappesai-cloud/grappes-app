import type { APIContext } from 'astro';
import { auth } from './auth';

/**
 * Server-side helper: read the current Better-Auth session from a request.
 * Replaces the old supabase.auth.getUser() pattern.
 *
 * Returns { user, session } or null when unauthenticated.
 */
export async function getSession(request: Request) {
  const result = await auth.api.getSession({ headers: request.headers });
  return result; // { user, session } | null
}

/**
 * Convenience: returns the user (or null) — drop-in for code that only needed user.id.
 */
export async function getUser(request: Request) {
  const result = await auth.api.getSession({ headers: request.headers });
  return result?.user ?? null;
}

/**
 * Astro endpoint helper — use inside Astro pages and API routes.
 */
export async function getSessionFromContext(ctx: Pick<APIContext, 'request'>) {
  return getSession(ctx.request);
}
