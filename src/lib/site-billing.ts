// ── Per-site billing ────────────────────────────────────────────────────────

// Paid billing types (does not include 'free' — use SiteBillingType from db.ts for DB storage)
export type SiteBillingType = 'monthly' | 'annual' | 'lifetime';

// Fixed price per site (no volume discounts)
const BASE_PRICES: Record<SiteBillingType, number> = {
  monthly: 15,   // €/month
  annual: 100,   // €/year
  lifetime: 350, // one-time
};

/** Price in euros for a new site */
export function getSitePrice(billingType: SiteBillingType): number {
  return BASE_PRICES[billingType];
}

/** ISO expiry date for a paid activation (null = lifetime = never expires) */
export function getExpiresAt(billingType: SiteBillingType): string | null {
  if (billingType === 'lifetime') return null;
  const now = Date.now();
  if (billingType === 'monthly') {
    // Add 30 days (avoids setMonth overflow: Jan 31 + 1 month = Mar 3)
    return new Date(now + 30 * 24 * 60 * 60 * 1000).toISOString();
  }
  if (billingType === 'annual') {
    return new Date(now + 365 * 24 * 60 * 60 * 1000).toISOString();
  }
  return null;
}

/** ISO expiry date for a free deployment (7 days from now) */
export function getFreeExpiresAt(): string {
  const d = new Date();
  d.setDate(d.getDate() + 7);
  return d.toISOString();
}
