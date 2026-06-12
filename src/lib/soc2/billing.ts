// ── SOC 2 Lab — billing posture (single source of truth) ───────────────────
// Grappes is a white-label platform: SOC 2 credits are provisioned by an admin
// (grant-soc2-credits + migration 0029), not bought self-serve. A specific
// deployment can opt into Stripe self-serve by setting SOC2_SELF_SERVE_CREDITS=1
// AND configuring a Stripe price. The hub UI and the buy-credits endpoint both
// read this one helper, so the "buy" button and the "contact your administrator"
// empty state can never contradict each other.

/**
 * True only when self-serve Stripe purchase of SOC 2 credits is both explicitly
 * enabled and fully configured. False (white-label / admin-granted) otherwise —
 * which is the default.
 */
export function soc2SelfServeBilling(): boolean {
  return (
    import.meta.env.SOC2_SELF_SERVE_CREDITS === '1' &&
    !!import.meta.env.STRIPE_SECRET_KEY &&
    !!import.meta.env.SOC2_CREDITS_PRICE_ID
  );
}
