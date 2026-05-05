/**
 * Server-side helpers for calling Better-Auth from Astro page actions
 * (sign-in/sign-up/forgot/reset). Forwards Set-Cookie headers from Better-Auth
 * to the redirect response so the session cookie sticks.
 */

import { auth } from './auth';

type AuthApi = typeof auth.api;
type ApiKey = keyof AuthApi;

interface CallResult<T = any> {
  ok: boolean;
  status: number;
  data: T | null;
  error: string | null;
  setCookieHeaders: string[];
}

export async function callAuthApi<K extends ApiKey>(
  method: K,
  body: any,
  headers: Headers
): Promise<CallResult> {
  try {
    const fn = (auth.api as any)[method];
    const response: Response = await fn({
      body,
      headers,
      asResponse: true,
    });
    const setCookieHeaders = (response.headers as any).getSetCookie?.() ?? [];
    let data: any = null;
    let error: string | null = null;
    const text = await response.text();
    if (text) {
      try {
        const json = JSON.parse(text);
        if (response.ok) data = json;
        else error = json?.message ?? json?.error ?? 'Unknown error';
      } catch {
        if (!response.ok) error = text;
      }
    } else if (!response.ok) {
      error = `HTTP ${response.status}`;
    }
    return { ok: response.ok, status: response.status, data, error, setCookieHeaders };
  } catch (err: any) {
    const message = err?.body?.message || err?.message || 'Auth API error';
    return { ok: false, status: 500, data: null, error: message, setCookieHeaders: [] };
  }
}

/**
 * Build a redirect Response that forwards any Set-Cookie headers from a Better-Auth call.
 */
export function redirectWithCookies(location: string, setCookieHeaders: string[]): Response {
  const headers = new Headers({ Location: location });
  for (const cookie of setCookieHeaders) {
    headers.append('Set-Cookie', cookie);
  }
  return new Response(null, { status: 302, headers });
}
