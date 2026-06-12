// ── Buy a SOC 2 Lab credits pack ───────────────────────────────────────────
// Webhook handler credits the balance (+10 pack on a `soc2_credits` checkout).
//
// Grappes is white-label by default: SOC 2 credits are provisioned by an admin
// (see grant-soc2-credits + migration 0029), NOT self-served. This Stripe path
// is therefore OFF unless a deployment explicitly opts in by setting
// SOC2_SELF_SERVE_CREDITS=1 (and configuring the Stripe price). The hub UI reads
// the same flag, so the two never contradict each other.

import type { APIRoute } from "astro";
import Stripe from "stripe";
import { db } from "../../../lib/db";
import { checkRateLimit } from "../../../lib/rate-limit";
import { json } from "../../../lib/api-utils";
import { soc2SelfServeBilling } from "../../../lib/soc2/billing";

const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? "https://grappes.dev";

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: "Unauthorized" }, 401);

  // White-label deployments provision credits via an admin, not Stripe.
  if (!soc2SelfServeBilling()) {
    return json({ error: "Self-serve purchase is disabled. Contact your administrator to top up SOC 2 credits." }, 403);
  }

  if (!checkRateLimit(`buy-soc2-credits:${user.id}`, 5, 60_000)) {
    return json({ error: "Too many requests. Please wait a moment." }, 429);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const priceId  = import.meta.env.SOC2_CREDITS_PRICE_ID;
  if (!stripeKey || !priceId) return json({ error: "Stripe not configured" }, 503);

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-03-25.dahlia" });
  const dbUser = await db.users.findById(user.id);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: user.id, type: "soc2_credits" },
      success_url: `${SITE_URL}/soc2?credits_purchased=1`,
      cancel_url:  `${SITE_URL}/soc2`,
      customer_creation: "always",
      ...(dbUser?.stripe_customer_id
        ? { customer: dbUser.stripe_customer_id }
        : user.email ? { customer_email: user.email } : {}),
    });
    return json({ url: session.url });
  } catch (e: any) {
    console.error("[buy-soc2-credits] Stripe error:", e.message);
    return json({ error: "Payment error. Please try again." }, 500);
  }
};
