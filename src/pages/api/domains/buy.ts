/**
 * Domain purchase is handled via Stripe checkout + webhook.
 * See: /api/billing/buy-domain (creates checkout session)
 *      /api/webhooks/stripe     (executes purchase after payment)
 *      /lib/domain-purchase.ts  (Vercel purchase logic)
 */
import type { APIRoute } from 'astro';

export const POST: APIRoute = () =>
  new Response(JSON.stringify({ error: 'Use /api/billing/buy-domain instead.' }), {
    status: 410,
    headers: { 'Content-Type': 'application/json' },
  });
