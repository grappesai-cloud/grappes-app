// ── Plan upgrade checkout ─────────────────────────────────────────────────────
// Creates a Stripe Checkout session for starter/pro/agency plans.

import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


const PLAN_MODES: Record<string, 'subscription' | 'payment'> = {
  starter: 'subscription',
  pro:     'subscription',
  agency:  'payment',
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 5 checkout attempts per minute per user
  if (!checkRateLimit(`checkout:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const plan = body.plan as string;

  if (!['starter', 'pro', 'agency'].includes(plan)) {
    return json({ error: 'Plan invalid' }, 400);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const priceEnv: Record<string, string | undefined> = {
    starter: import.meta.env.STRIPE_PRICE_STARTER,
    pro:     import.meta.env.STRIPE_PRICE_PRO,
    agency:  import.meta.env.STRIPE_PRICE_AGENCY,
  };
  const priceId = priceEnv[plan];

  if (!stripeKey || !priceId) {
    return json({ error: 'Stripe not configured for this plan' }, 503);
  }

  const stripe   = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
  const siteUrl  = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';
  const mode     = PLAN_MODES[plan];

  const client = createAdminClient();
  const { data: dbUser } = await client
    .from('users')
    .select('plan, stripe_customer_id, email')
    .eq('id', user.id)
    .single();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode,
    payment_method_types: ['card'],
    line_items: [{ price: priceId, quantity: 1 }],
    metadata: { user_id: user.id, plan },
    success_url: `${siteUrl}/dashboard/account?upgraded=1`,
    cancel_url:  `${siteUrl}/dashboard/account`,
    customer_email: user.email ?? undefined,
    // Always create a Stripe customer so stripe_customer_id is always saved
    ...(mode === 'payment' && { customer_creation: 'always' }),
  };

  // For subscriptions: pass metadata on the subscription object too
  // (used by customer.subscription.updated webhook)
  if (mode === 'subscription') {
    sessionParams.subscription_data = {
      metadata: { user_id: user.id, plan },
    };
  }

  // Re-use existing Stripe customer if available
  if (dbUser?.stripe_customer_id) {
    sessionParams.customer = dbUser.stripe_customer_id;
    delete sessionParams.customer_email;
  }

  try {
    const session = await stripe.checkout.sessions.create(sessionParams);
    return json({ url: session.url });
  } catch (e: any) {
    console.error('[checkout] Stripe error:', e.message);
    return json({ error: 'Failed to create checkout session' }, 500);
  }
};
