// One-time $5 USD purchase to remove the "by grappes.dev" footer badge from a project's site.
// POST { projectId }
// Returns { url: stripeCheckoutUrl }
// On webhook completion, projects.branding_removed flips to true and the site is re-deployed.

import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { db } from '../../../lib/db';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

const REMOVE_BRANDING_PRICE_USD = 5;

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`remove-branding:${user.id}`, 5, 60_000)) {
    return json({ error: 'Too many requests. Please wait a moment.' }, 429);
  }

  const body = await request.json().catch(() => ({}));
  const { projectId } = body as { projectId?: string };
  if (!projectId) return json({ error: 'projectId required' }, 400);

  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  if ((project as any).branding_removed) {
    return json({ error: 'Branding already removed for this project' }, 409);
  }

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  const siteUrl   = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';
  if (!stripeKey) return json({ error: 'Stripe not configured' }, 503);

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
  const dbUser = await db.users.findById(user.id);

  const sessionParams: Stripe.Checkout.SessionCreateParams = {
    mode: 'payment',
    payment_method_types: ['card'],
    line_items: [{
      quantity: 1,
      price_data: {
        currency: 'usd',
        unit_amount: REMOVE_BRANDING_PRICE_USD * 100,
        product_data: {
          name: 'Grappes — Remove "by grappes.dev" badge',
          description: 'One-time payment. Removes the bottom-right badge from your published site forever.',
        },
      },
    }],
    metadata: {
      user_id: user.id,
      project_id: projectId,
      type: 'remove_branding',
    },
    success_url: `${siteUrl}/dashboard/${projectId}?branding_removed=1`,
    cancel_url:  `${siteUrl}/dashboard/${projectId}`,
    customer_creation: 'always',
  };

  if (dbUser?.stripe_customer_id) {
    sessionParams.customer = dbUser.stripe_customer_id;
  } else if (user.email) {
    sessionParams.customer_email = user.email;
  }

  const session = await stripe.checkout.sessions.create(sessionParams);
  return json({ url: session.url, priceUsd: REMOVE_BRANDING_PRICE_USD });
};
