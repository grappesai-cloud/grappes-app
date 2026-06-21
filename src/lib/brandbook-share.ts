// Stable, unguessable share token for a brand book: HMAC(id, SHARE_TOKEN_SECRET).
// Lets anyone with the link view the book read-only, no account needed, while a
// plain id alone can't be enumerated.
import { createHmac, timingSafeEqual } from 'node:crypto';
import { e } from './env';

export function brandbookShareToken(id: string): string {
  const secret = e('SHARE_TOKEN_SECRET') || e('BETTER_AUTH_SECRET') || 'grappes';
  return createHmac('sha256', secret).update(`brandbook:${id}`).digest('hex').slice(0, 24);
}

export function verifyBrandbookShareToken(id: string, token: string): boolean {
  const expected = brandbookShareToken(id);
  if (!token || token.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}
