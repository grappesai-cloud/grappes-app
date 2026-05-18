// ── Buy a reel-credits pack (€50 for 10 analyses) ──────────────────────────
// Mirrors buy-edits.ts. Creates a Stripe Checkout session for a one-time
// purchase. On success, the stripe webhook (checkout.session.completed)
// credits reel_credits via increment_reel_credits().

import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { db } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`buy-reel-credits:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const priceId  = import.meta.env.REEL_CREDITS_PRICE_ID;

  if (!stripeKey || !priceId) {
    return json({ error: 'Stripe not configured' }, 503);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });

  const dbUser = await db.users.findById(user.id);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: user.id, type: 'reel_credits' },
      success_url: `${SITE_URL}/dashboard/reels?credits_purchased=1`,
      cancel_url:  `${SITE_URL}/dashboard/reels`,
      customer_creation: 'always',
      ...(dbUser?.stripe_customer_id
        ? { customer: dbUser.stripe_customer_id }
        : user.email ? { customer_email: user.email } : {}),
    });
    return json({ url: session.url });
  } catch (e: any) {
    console.error('[buy-reel-credits] Stripe error:', e.message);
    return json({ error: 'Payment error. Please try again.' }, 500);
  }
};
