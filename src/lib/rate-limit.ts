// ── Hybrid rate limiter ────────────────────────────────────────────────────────
// In-memory Map for fast burst protection within a single instance.
// Supabase-backed counter for cross-instance persistence on expensive operations.
// The in-memory layer catches same-instance repeats instantly; the DB layer
// catches cross-instance abuse at the cost of one query per check.

const store = new Map<string, number[]>();

/**
 * Fast in-memory rate limiter (per-instance).
 * Returns true if ALLOWED, false if rate-limited.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  const history = (store.get(key) ?? []).filter(ts => now - ts < windowMs);
  if (history.length >= max) return false;
  history.push(now);
  store.set(key, history);
  return true;
}

/**
 * Persistent rate limiter backed by Supabase.
 * Use for expensive operations (AI generation, Stripe checkout, launch).
 * Falls back to in-memory if DB is unavailable.
 */
export async function checkPersistentRateLimit(
  key: string,
  max: number,
  windowMs: number
): Promise<boolean> {
  // Always check in-memory first (fast path)
  if (!checkRateLimit(key, max, windowMs)) return false;

  try {
    const { createAdminClient } = await import('./supabase');
    const client = createAdminClient();
    const windowStart = new Date(Date.now() - windowMs).toISOString();

    // Count recent entries for this key
    const { count, error } = await client
      .from('rate_limits')
      .select('*', { count: 'exact', head: true })
      .eq('key', key)
      .gte('created_at', windowStart);

    if (error) {
      // DB unavailable — fall through to in-memory only (already passed above)
      console.warn('[rate-limit] DB check failed, using in-memory only:', error.message);
      return true;
    }

    if ((count ?? 0) >= max) return false;

    // Don't record here — caller records on success via recordPersistentRateLimit()
    return true;
  } catch {
    // Fallback: in-memory passed, allow
    return true;
  }
}

/**
 * Record a successful rate-limited operation in the DB.
 * Call this AFTER the operation succeeds, not before — so failed attempts
 * don't consume rate-limit slots.
 */
export async function recordPersistentRateLimit(key: string): Promise<void> {
  try {
    const { createAdminClient } = await import('./supabase');
    const client = createAdminClient();
    await client.from('rate_limits').insert({ key, created_at: new Date().toISOString() });
  } catch (e) {
    console.warn('[rate-limit] Failed to record rate limit entry:', e);
  }
}

/**
 * Extracts the real client IP from Vercel / proxy headers.
 */
export function getClientIp(request: Request): string {
  // Prefer Vercel-set headers (cannot be spoofed by client) over x-forwarded-for
  return (
    request.headers.get('x-real-ip') ??
    request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim() ??
    request.headers.get('x-forwarded-for')?.split(',')[0]?.trim() ??
    'unknown'
  );
}
