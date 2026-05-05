import type { APIRoute } from 'astro';
import { auth } from '../../../lib/auth';

/**
 * Catch-all Better-Auth handler. Mounted at /api/auth/*
 * Replaces the previous Supabase-specific routes (google.ts, callback.ts, signout.ts, password-changed.ts).
 */
export const ALL: APIRoute = async ({ request }) => auth.handler(request);
export const GET = ALL;
export const POST = ALL;
