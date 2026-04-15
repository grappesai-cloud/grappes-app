import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { suppressEmail } from '../../../lib/resend';

export const POST: APIRoute = async ({ request }) => {
  const secret = import.meta.env.RESEND_WEBHOOK_SECRET;
  if (!secret) {
    console.error('[resend-webhook] RESEND_WEBHOOK_SECRET not set');
    return new Response('Server error', { status: 500 });
  }

  // Read body once
  const rawBody = await request.text();

  // Verify webhook signature
  const svixId = request.headers.get('svix-id');
  const svixTimestamp = request.headers.get('svix-timestamp');
  const svixSignature = request.headers.get('svix-signature');

  if (!svixId || !svixTimestamp || !svixSignature) {
    return new Response('Missing signature headers', { status: 401 });
  }

  // Resend uses Svix for webhooks
  const toSign = `${svixId}.${svixTimestamp}.${rawBody}`;

  // svix-signature can be "v1,<base64sig> v1,<base64sig2>" — check each
  const signatures = svixSignature.split(' ');
  let verified = false;

  // Secret from Resend starts with "whsec_" — strip prefix and base64-decode
  const secretBytes = Buffer.from(secret.replace(/^whsec_/, ''), 'base64');

  for (const sig of signatures) {
    const [version, sigValue] = sig.split(',');
    if (version !== 'v1' || !sigValue) continue;
    const expected = createHmac('sha256', secretBytes).update(toSign).digest('base64');
    if (expected.length === sigValue.length && timingSafeEqual(Buffer.from(expected), Buffer.from(sigValue))) {
      verified = true;
      break;
    }
  }

  if (!verified) {
    console.warn('[resend-webhook] Invalid signature');
    return new Response('Invalid signature', { status: 401 });
  }

  // Check timestamp freshness (5 min tolerance)
  const ts = parseInt(svixTimestamp, 10);
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > 300) {
    return new Response('Timestamp too old', { status: 401 });
  }

  let event: any;
  try {
    event = JSON.parse(rawBody);
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const type = event.type as string;
  const data = event.data as any;

  try {
    if (type === 'email.bounced') {
      const email = data?.to?.[0];
      if (email) {
        console.error(`[resend-webhook] Hard bounce: ${email}`);
        await suppressEmail(email, 'hard_bounce');
        // Also mark user row
        try {
          const { createAdminClient } = await import('../../../lib/supabase');
          const client = createAdminClient();
          await client
            .from('users')
            .update({ email_bounced_at: new Date().toISOString() })
            .eq('email', email);
        } catch (e) {
          console.error('[resend-webhook] Failed to mark user bounce:', e);
        }
      }
    } else if (type === 'email.complained') {
      const email = data?.to?.[0];
      if (email) {
        console.error(`[resend-webhook] Spam complaint: ${email}`);
        await suppressEmail(email, 'spam_complaint');
        try {
          const { createAdminClient } = await import('../../../lib/supabase');
          const client = createAdminClient();
          await client
            .from('users')
            .update({ email_bounced_at: new Date().toISOString() })
            .eq('email', email);
        } catch (e) {
          console.error('[resend-webhook] Failed to mark user complaint:', e);
        }
      }
    } else if (type === 'email.delivery_delayed') {
      const email = data?.to?.[0];
      console.warn(`[resend-webhook] Delivery delayed: ${email ?? 'unknown'}`);
    }
  } catch (e: any) {
    console.error('[resend-webhook] Processing error:', e);
    // Still return 200 to prevent Resend from retrying
  }

  return new Response(JSON.stringify({ received: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
