import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { db } from '../../../lib/db';
import { getDomainChargeEur, getVercelDomainPrice } from '../../../lib/domain-purchase';
import { json } from '../../../lib/api-utils';


/**
 * POST /api/billing/buy-domain
 * Body: { projectId, domainName, domainPriceUsd }
 *
 * Creates a Stripe one-time checkout session for domain purchase.
 * After payment, the Stripe webhook handles the actual Vercel purchase.
 */
export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body             = await request.json().catch(() => ({}));
  const projectId: string   = body.projectId ?? '';
  const domainName: string  = (body.domainName ?? '').toLowerCase().trim();
  const domainPriceUsd      = Number(body.domainPriceUsd) || 0;

  if (!projectId || !domainName) return json({ error: 'projectId and domainName required.' }, 400);

  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Project not found.' }, 404);
  if (project.status !== 'live') return json({ error: 'Site must be live to buy a domain.' }, 409);

  const stripeKey = import.meta.env.STRIPE_SECRET_KEY;
  if (!stripeKey) return json({ error: 'Stripe not configured.' }, 503);

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });

  // Validate price server-side via Vercel API — NEVER trust client-supplied price
  const verifiedPriceUsd = await getVercelDomainPrice(domainName);
  if (verifiedPriceUsd === null) {
    return json({ error: 'Nu s-a putut verifica prețul domeniului. Încearcă din nou.' }, 503);
  }
  const trustedPriceUsd = verifiedPriceUsd;
  const chargeEur = getDomainChargeEur(trustedPriceUsd);

  // Retrieve or reuse Stripe customer
  const { data: userRow } = await (await import('../../../lib/supabase')).createAdminClient()
    .from('users').select('stripe_customer_id, email').eq('id', user.id).maybeSingle();

  const customerParam = userRow?.stripe_customer_id
    ? { customer: userRow.stripe_customer_id }
    : { customer_email: userRow?.email ?? undefined };

  const origin = import.meta.env.SITE ?? 'https://grappes.ai';

  const session = await stripe.checkout.sessions.create({
    mode: 'payment',
    ...customerParam,
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: chargeEur * 100, // cents
          product_data: {
            name: `Domeniu: ${domainName}`,
            description: `Înregistrare domeniu ${domainName} — 1 an`,
          },
        },
      },
    ],
    metadata: {
      type:               'buy_domain',
      user_id:            user.id,
      project_id:         projectId,
      domain_name:        domainName,
      expected_price_usd: String(trustedPriceUsd),
    },
    success_url: `${origin}/dashboard/${projectId}?domain_purchased=1`,
    cancel_url:  `${origin}/dashboard/${projectId}`,
  });

  return json({ url: session.url, chargeEur, priceUsd: trustedPriceUsd });
};
