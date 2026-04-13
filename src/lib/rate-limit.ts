// ── Hybrid rate limiter ────────────────────────────────────────────────────────
// In-memory Map for fast burst protection within a single instance.
// Supabase-backed counter for cross-instance persistence on expensive operations.
// The in-memory layer catches same-instance repeats instantly; the DB layer
// catches cross-instance abuse at the cost of one query per check.

const store = new Map<string, number[]>();
const MAX_STORE_KEYS = 10_000;
let lastSweep = Date.now();

/** Evict expired entries to prevent unbounded memory growth under many unique IPs */
function sweepStore(windowMs: number): void {
  const now = Date.now();
  // Sweep at most once per 60s
  if (now - lastSweep < 60_000) return;
  lastSweep = now;

  for (const [key, timestamps] of store) {
    const live = timestamps.filter(ts => now - ts < windowMs);
    if (live.length === 0) {
      store.delete(key);
    } else {
      store.set(key, live);
    }
  }

  // Hard cap: if still too large, evict oldest entries
  if (store.size > MAX_STORE_KEYS) {
    const excess = store.size - MAX_STORE_KEYS;
    const keys = store.keys();
    for (let i = 0; i < excess; i++) {
      const { value } = keys.next();
      if (value) store.delete(value);
    }
  }
}

/**
 * Fast in-memory rate limiter (per-instance).
 * Returns true if ALLOWED, false if rate-limited.
 */
export function checkRateLimit(key: string, max: number, windowMs: number): boolean {
  const now = Date.now();
  sweepStore(windowMs);
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
