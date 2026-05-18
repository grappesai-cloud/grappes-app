// ── POST /api/kits/[id]/publish ────────────────────────────────────────────
// Creates a Stripe Checkout session for €15 to publish a press kit.
// Webhook handler (metadata.type = "kit_publish") flips the kit to status =
// 'published', generates a slug, and stamps published_at on payment success.

import type { APIRoute } from "astro";
import Stripe from "stripe";
import { createAdminClient } from "../../../../lib/supabase";
import { db } from "../../../../lib/db";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { json } from "../../../../lib/api-utils";

const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? "https://grappes.dev";

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  if (!checkRateLimit(`kits-publish:${user.id}`, 5, 60_000)) {
    return json({ error: "Too many requests." }, 429);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const priceId  = import.meta.env.PRESS_KIT_PRICE_ID;
  if (!stripeKey || !priceId) return json({ error: "Stripe not configured" }, 503);

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, status, name")
    .eq("id", params.id)
    .maybeSingle();

  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);
  if (kit.status === "published") return json({ error: "Already published" }, 400);

  const stripe = new Stripe(stripeKey, { apiVersion: "2026-03-25.dahlia" });
  const dbUser = await db.users.findById(user.id);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: {
        user_id: user.id,
        type: "kit_publish",
        kit_id: params.id,
        kit_name: kit.name.slice(0, 80),
      },
      success_url: `${SITE_URL}/kits/${params.id}?published=1`,
      cancel_url:  `${SITE_URL}/kits/${params.id}`,
      customer_creation: "always",
      ...(dbUser?.stripe_customer_id
        ? { customer: dbUser.stripe_customer_id }
        : user.email ? { customer_email: user.email } : {}),
    });

    // Cache session id on the kit so we can reconcile if webhook is late
    await client
      .from("press_kits")
      .update({ stripe_session_id: session.id, updated_at: new Date().toISOString() })
      .eq("id", params.id);

    return json({ url: session.url });
  } catch (e: any) {
    console.error("[kits/publish] Stripe error:", e.message);
    return json({ error: "Payment error. Please try again." }, 500);
  }
};
