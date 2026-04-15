// Shared admin session verifier used by all /api/admin endpoints + admin pages.
import { timingSafeEqual, createHmac } from 'node:crypto';

export function verifyAdminSession(token: string | undefined | null): boolean {
  const secret = import.meta.env.ADMIN_SECRET ?? '';
  if (!secret || !token) return false;
  const dot = token.indexOf('.');
  if (dot === -1) return false;
  const nonce = token.slice(0, dot);
  const sig   = token.slice(dot + 1);
  if (!nonce || !sig) return false;
  const expected = createHmac('sha256', secret).update(nonce).digest('hex');
  if (sig.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
}
