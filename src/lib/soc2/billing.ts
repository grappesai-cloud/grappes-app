// ── SOC 2 Lab — billing posture (single source of truth) ───────────────────
// Grappes is a white-label platform: SOC 2 credits are provisioned by an admin
// (grant-soc2-credits), never bought self-serve. This helper is the single
// source of truth read by the hub UI and empty state, so the "contact your
// administrator" message is always shown instead of a buy button.

/** Self-serve purchase of SOC 2 credits is disabled (admin-granted only). */
export function soc2SelfServeBilling(): boolean {
  return false;
}
