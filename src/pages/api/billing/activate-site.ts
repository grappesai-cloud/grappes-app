// ── Per-site activation checkout ──────────────────────────────────────────────
// POST { projectId, billingType: 'monthly' | 'annual' | 'lifetime' }
// Calculates volume-discounted price, creates a Stripe Checkout session.

import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { db } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { getSitePrice, type SiteBillingType } from '../../../lib/site-billing';
import { json } from '../../../lib/api-utils';


const BILLING_LABELS: Record<SiteBillingType, string> = {
  monthly:  'Lunar',
  annual:   'Anual',
  lifetime: 'Lifetime',
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`checkout:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const { projectId, billingType } = body as { projectId?: string; billingType?: string };

  if (!projectId) return json({ error: 'projectId required' }, 400);
  if (!['monthly', 'annual', 'lifetime'].includes(billingType ?? '')) {
    return json({ error: 'billingType must be monthly, annual, or lifetime' }, 400);
  }
  const type = billingType as SiteBillingType;

  // Verify project ownership
  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  if (project.billing_status === 'active') {
    return json({ error: 'Site already active' }, 409);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const siteUrl   = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';
  if (!stripeKey) return json({ error: 'Stripe not configured' }, 503);

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });

  const priceEuros = getSitePrice(type);
  const unitAmount = priceEuros * 100; // Stripe uses cents

  const productName = `Grappes — Site ${BILLING_LABELS[type]}`;
  const isSubscription = type !== 'lifetime';

  // Get/re-use Stripe customer
  const dbUser = await db.users.findById(user.id);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: isSubscription ? 'subscription' : 'payment',
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'eur',
        unit_amount: unitAmount,
        product_data: {
          name: productName,
        },
        ...(isSubscription && {
          recurring: { interval: type === 'monthly' ? 'month' : 'year' },
        }),
      },
    }],
    metadata: { user_id: user.id, project_id: projectId, billing_type: type, type: 'activate_site' },
    success_url: `${siteUrl}/dashboard/${projectId}?activated=1`,
    cancel_url:  `${siteUrl}/dashboard/${projectId}`,
    ...(isSubscription && {
      subscription_data: {
        metadata: { user_id: user.id, project_id: projectId, billing_type: type, type: 'site_subscription' },
      },
    }),
    ...(!isSubscription && { customer_creation: 'always' }),
  };

  if (dbUser?.stripe_customer_id) {
    sessionParams.customer = dbUser.stripe_customer_id;
  } else if (user.email) {
    sessionParams.customer_email = user.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return json({ url: session.url, priceEuros });
};
