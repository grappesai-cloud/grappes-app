import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


export const POST: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 5 portal session attempts/minute per user
  if (!checkRateLimit(`billing-portal:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    return json({ error: 'Stripe not configured' }, 503);
  }

  const client = createAdminClient();
  const { data: dbUser } = await client
    .from('users')
    .select('stripe_customer_id')
    .eq('id', user.id)
    .single();

  if (!dbUser?.stripe_customer_id) {
    return json({ error: 'No Stripe customer found for this account' }, 503);
  }

  try {
    const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
    const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

    const session = await stripe.billingPortal.sessions.create({
      customer: dbUser.stripe_customer_id,
      return_url: `${siteUrl}/dashboard/account`,
    });

    return json({ url: session.url });
  } catch (e: any) {
    console.error('[POST /api/billing/portal]', e);
    return json({ error: e.message || 'Failed to create portal session' }, 500);
  }
};
