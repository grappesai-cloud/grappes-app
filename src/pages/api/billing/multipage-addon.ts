import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`checkout:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const interval = body.interval as string; // 'month' | 'year' | 'lifetime'

  if (!['month', 'year', 'lifetime'].includes(interval)) {
    return json({ error: 'Invalid interval. Use "month", "year", or "lifetime".' }, 400);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const siteUrl   = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.ai';

  if (!stripeKey) return json({ error: 'Stripe not configured' }, 503);

  const priceMap: Record<string, string | undefined> = {
    month:    import.meta.env.MULTIPAGE_MONTHLY_PRICE_ID,
    year:     import.meta.env.MULTIPAGE_YEARLY_PRICE_ID,
    lifetime: import.meta.env.MULTIPAGE_LIFETIME_PRICE_ID,
  };
  const priceId = priceMap[interval];

  if (!priceId) return json({ error: 'Add-on price not configured' }, 503);

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
  const isLifetime = interval === 'lifetime';

  // Get customer ID if user already has one
  const client = createAdminClient();
  const { data: dbUser } = await client.from('users').select('stripe_customer_id, email').eq('id', user.id).single();

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode:        isLifetime ? 'payment' : 'subscription',
    line_items:  [{ price: priceId, quantity: 1 }],
    success_url: `${siteUrl}/dashboard/account?addon=activated`,
    cancel_url:  `${siteUrl}/dashboard/account`,
    metadata:    { user_id: user.id, type: 'multipage_addon', interval },
    // For subscriptions, pass metadata on the subscription object too
    ...(!isLifetime && {
      subscription_data: {
        metadata: { user_id: user.id, type: 'multipage_addon' },
      },
    }),
    // For one-time payments, always create a Stripe customer
    ...(isLifetime && { customer_creation: 'always' }),
  };

  if (dbUser?.stripe_customer_id) {
    sessionParams.customer = dbUser.stripe_customer_id;
  } else if (dbUser?.email) {
    sessionParams.customer_email = dbUser.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return json({ url: session.url });
};
