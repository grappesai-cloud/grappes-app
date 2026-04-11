// ── Buy extra edit pack (€5 for 10 edits) ────────────────────────────────────
// Creates a Stripe Checkout session for a one-time purchase.
// On success, the stripe webhook (checkout.session.completed) credits extra_edits.

import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { db } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.ai';

export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 5 purchase attempts per minute per user
  if (!checkRateLimit(`buy-edits:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const priceId  = import.meta.env.EXTRA_EDITS_PRICE_ID;

  if (!stripeKey || !priceId) {
    return json({ error: 'Stripe not configured' }, 503);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });

  // Reuse existing Stripe customer if available
  const dbUser = await db.users.findById(user.id);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { user_id: user.id, type: 'extra_edits' },
      success_url: `${SITE_URL}/dashboard?edits_purchased=1`,
      cancel_url:  `${SITE_URL}/dashboard`,
      customer_creation: 'always',
      ...(dbUser?.stripe_customer_id
        ? { customer: dbUser.stripe_customer_id }
        : user.email ? { customer_email: user.email } : {}),
    });
    return json({ url: session.url });
  } catch (e: any) {
    console.error('[buy-edits] Stripe error:', e.message);
    return json({ error: 'Payment error. Please try again.' }, 500);
  }
};
