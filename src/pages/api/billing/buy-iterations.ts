// ── Buy +10 AI iterations pack — $5 one-time per project ─────────────────────
// POST { projectId } → Stripe Checkout session.
// On success the webhook (checkout.session.completed) calls add_project_iterations.

import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { db } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';
const PACK_SIZE = 10;
const PACK_PRICE_USD_CENTS = 500; // $5.00

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`buy-iter:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const { projectId } = body as { projectId?: string };
  if (!projectId) return json({ error: 'projectId required' }, 400);

  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ error: 'Stripe not configured' }, 503);

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
  const dbUser = await db.users.findById(user.id);

  try {
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'usd',
          unit_amount: PACK_PRICE_USD_CENTS,
          product_data: {
            name: `Grappes — +${PACK_SIZE} AI iterations`,
            description: `Adds ${PACK_SIZE} more AI editor iterations to your project.`,
          },
        },
      }],
      metadata: {
        user_id:    user.id,
        project_id: projectId,
        type:       'buy_iterations',
        amount:     String(PACK_SIZE),
      },
      success_url: `${SITE_URL}/dashboard/${projectId}?iterations_bought=1`,
      cancel_url:  `${SITE_URL}/dashboard/${projectId}`,
      customer_creation: 'always',
      ...(dbUser?.stripe_customer_id
        ? { customer: dbUser.stripe_customer_id }
        : user.email ? { customer_email: user.email } : {}),
    });
    return json({ url: session.url });
  } catch (e: any) {
    console.error('[buy-iterations] Stripe error:', e.message);
    return json({ error: 'Payment error. Please try again.' }, 500);
  }
};
