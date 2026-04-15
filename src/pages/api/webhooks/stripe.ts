import type { APIRoute } from 'astro';
import Stripe from 'stripe';
import { createAdminClient } from '../../../lib/supabase';
import { db } from '../../../lib/db';
import { EXTRA_PACK_EDITS } from '../../../lib/edit-quota';
import { sendPaymentConfirmedEmail, sendReferralEarnedEmail, sendReferralPayoutAlert, sendSubscriptionCancelledEmail, sendDomainPurchaseFailedEmail } from '../../../lib/resend';
import { processReferralReward } from '../../../lib/referral';
import { getExpiresAt, getFreeExpiresAt, type SiteBillingType } from '../../../lib/site-billing';
import { purchaseDomainAndAttach } from '../../../lib/domain-purchase';
import { log } from '../../../lib/logger';
import { json } from '../../../lib/api-utils';


const PLAN_PROJECT_LIMITS: Record<string, number> = {
  free:    1,
  starter: 3,
  pro:     10,
  agency:  50,
};

export const POST: APIRoute = async ({ request }) => {
  const sig           = request.headers.get('stripe-signature');
  const webhookSecret = import.meta.env.STRIPE_WEBHOOK_SECRET;
  const stripeKey     = import.meta.env.STRIPE_SECRET_KEY;

  if (!sig || !webhookSecret || !stripeKey) {
    return json({ error: 'Stripe not configured' }, 400);
  }

  const stripe = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
  const rawBody = await request.text();

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err: any) {
    console.error('[Stripe webhook] Signature verification failed:', err.message);
    return json({ error: 'Invalid signature' }, 400);
  }

  const client = createAdminClient();
  console.log('[Stripe webhook]', event.type, event.id);

  try {
    // ── Global idempotency: skip already-processed events ─────────────────
    // Uses a unique constraint on stripe_processed_events.event_id.
    // If the INSERT fails (conflict) this is a Stripe retry — return 200 immediately.
    const { error: idempotencyError } = await client
      .from('stripe_processed_events')
      .insert({ event_id: event.id, event_type: event.type });

    if (idempotencyError) {
      if (idempotencyError.code === '23505') {
        // Unique constraint violation → already processed
        console.log(`[Stripe webhook] Duplicate event ${event.id} — skipping`);
        return json({ received: true, duplicate: true });
      }
      // Any other DB error: log but continue (don't block legitimate events)
      console.warn('[Stripe webhook] Idempotency insert error:', idempotencyError.message);
    }

    switch (event.type) {

      // ── One-time purchase: extra edit pack ──────────────────────────────
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        if (session.metadata?.type === 'extra_edits' && session.metadata?.user_id) {
          const userId = session.metadata.user_id;

          const { data: newTotal } = await client.rpc('increment_extra_edits', { p_user_id: userId, p_amount: EXTRA_PACK_EDITS });

          console.log(`[Stripe webhook] +${EXTRA_PACK_EDITS} extra edits credited to user ${userId}`);

          try {
            const { data: userRow } = await client
              .from('users')
              .select('email')
              .eq('id', userId)
              .single();
            if (userRow?.email) {
              await sendPaymentConfirmedEmail({
                to: userRow.email,
                editsAdded: EXTRA_PACK_EDITS,
                totalExtra: newTotal ?? 0,
              });
            }
          } catch (emailErr) {
            console.error('[Stripe webhook] Payment email failed:', emailErr);
          }
          break;
        }

        // ── Per-site activation ────────────────────────────────────────
        if (session.metadata?.type === 'activate_site' && session.metadata?.project_id) {
          const projectId  = session.metadata.project_id;
          const billingType = session.metadata.billing_type as SiteBillingType;
          const customerId  = typeof session.customer === 'string' ? session.customer : null;
          const subId       = typeof session.subscription === 'string' ? session.subscription : null;
          const piId        = typeof session.payment_intent === 'string' ? session.payment_intent : null;

          // Check status BEFORE update so we know if this is a renew (was expired)
          const projectBeforeActivation = await db.projects.findById(projectId);
          const wasExpired = projectBeforeActivation?.billing_status === 'expired';

          await db.projects.updateBilling(projectId, {
            billing_type:            billingType,
            billing_status:          'active',
            activated_at:            new Date().toISOString(),
            expires_at:              getExpiresAt(billingType),
            ...(subId && { site_subscription_id: subId }),
            ...(piId  && { site_payment_intent_id: piId }),
          }, ['free', 'expired']);

          // Save customer ID on user for future checkouts
          if (customerId && session.metadata.user_id) {
            await client
              .from('users')
              .update({ stripe_customer_id: customerId })
              .eq('id', session.metadata.user_id);
          }
          console.log(`[Stripe webhook] Site ${projectId} activated — ${billingType}`);

          // If this was a renew of a previously expired site, the Vercel
          // deployment is still showing the /expired redirect placeholder.
          // Restore the real HTML from generated_files so the site is live again.
          if (wasExpired && projectBeforeActivation?.vercel_project_id) {
            try {
              const latest = await db.generatedFiles.findLatest(projectId);
              if (latest?.files && Object.keys(latest.files).length > 0) {
                const { deployHtml } = await import('../../../lib/vercel-api');
                const projectNameSafe = (projectBeforeActivation.name || 'grappes-site')
                  .toLowerCase().replace(/[^a-z0-9-]/g, '-').slice(0, 52) || 'grappes-site';
                const result = await deployHtml(
                  projectBeforeActivation.vercel_project_id,
                  projectNameSafe,
                  latest.files as Record<string, string>,
                );
                if (result.ok) {
                  console.log(`[Stripe webhook] Restored real HTML for renewed site ${projectId}`);
                } else {
                  console.warn(`[Stripe webhook] HTML restore failed for ${projectId}:`, result.error);
                }
              } else {
                console.warn(`[Stripe webhook] No generated_files found for renewed site ${projectId}`);
              }
            } catch (restoreErr) {
              console.error('[Stripe webhook] HTML restore threw:', restoreErr);
            }
          }

          // Process referral reward for first site activation
          if (session.metadata?.user_id) {
            try {
              const { processPerSiteReferralReward } = await import('../../../lib/referral');
              const { sendReferralEarnedEmail, sendReferralPayoutAlert } = await import('../../../lib/resend');
              const reward = await processPerSiteReferralReward(session.metadata.user_id, billingType);
              if (reward) {
                await sendReferralEarnedEmail({ to: reward.referrerEmail, amount: reward.amount, newBalance: reward.newBalance, plan: billingType });
                if (reward.shouldNotify) {
                  await sendReferralPayoutAlert({ referrerEmail: reward.referrerEmail, amount: reward.newBalance });
                }
              }
            } catch (refErr) {
              console.error('[Stripe webhook] Per-site referral reward failed:', refErr);
            }
          }
          break;
        }

        // ── Domain purchase ────────────────────────────────────────────
        if (session.metadata?.type === 'buy_domain' && session.metadata?.project_id) {
          const projectId      = session.metadata.project_id;
          const domainName     = session.metadata.domain_name;
          const expectedPriceUsd = Number(session.metadata.expected_price_usd) || 0;

          const project = await db.projects.findById(projectId);
          const err = await purchaseDomainAndAttach(
            projectId,
            project?.vercel_project_id,
            domainName,
            expectedPriceUsd,
          );
          if (err) {
            console.error(`[Stripe webhook] Domain purchase failed for ${domainName}:`, err);
            // Mark as pending so admin can retry — domain is paid, Vercel purchase pending
            await client
              .from('projects')
              .update({ custom_domain: domainName, domain_verified: false, updated_at: new Date().toISOString() })
              .eq('id', projectId);
            // Alert admin about failed domain purchase
            try { await sendDomainPurchaseFailedEmail({ domain: domainName, projectId, error: err }); } catch (e) { console.error('[Stripe webhook] Domain failure email error:', e); }
          } else {
            console.log(`[Stripe webhook] Domain ${domainName} purchased and attached to project ${projectId}`);
          }
          break;
        }

        // ── Multi-page add-on (subscription or lifetime one-time) ────
        if (session.metadata?.type === 'multipage_addon' && session.metadata?.user_id) {
          const userId     = session.metadata.user_id;
          const customerId = typeof session.customer === 'string' ? session.customer : null;
          const subId      = typeof session.subscription === 'string' ? session.subscription : null;
          const isLifetime = session.metadata.interval === 'lifetime';
          await client
            .from('users')
            .update({
              multipage_addon: true,
              ...(isLifetime && { multipage_addon_lifetime: true }),
              ...(subId      && { multipage_addon_subscription_id: subId }),
              ...(customerId && { stripe_customer_id: customerId }),
            })
            .eq('id', userId);
          console.log(`[Stripe webhook] Multi-page add-on activated for user ${userId} (${isLifetime ? 'lifetime' : 'subscription'})`);
          break;
        }

        // ── Subscription checkout: upgrade plan ────────────────────────
        if (session.metadata?.plan && session.metadata?.user_id) {
          const plan       = session.metadata.plan as 'starter' | 'pro' | 'agency';
          const userId     = session.metadata.user_id;
          const customerId = typeof session.customer === 'string' ? session.customer : null;

          await client
            .from('users')
            .update({
              plan,
              projects_limit: PLAN_PROJECT_LIMITS[plan] ?? 1,
              ...(customerId && { stripe_customer_id: customerId }),
            })
            .eq('id', userId);

          // Process referral reward for this plan purchase
          try {
            const reward = await processReferralReward(userId, plan);
            if (reward) {
              await sendReferralEarnedEmail({
                to: reward.referrerEmail,
                amount: reward.amount,
                newBalance: reward.newBalance,
                plan,
              });
              if (reward.shouldNotify) {
                await sendReferralPayoutAlert({
                  referrerEmail: reward.referrerEmail,
                  amount: reward.newBalance,
                });
              }
            }
          } catch (refErr) {
            console.error('[Stripe webhook] Referral reward failed:', refErr);
          }
        }
        break;
      }

      // ── Subscription updated (site renewal or legacy plan change) ──────────
      case 'customer.subscription.updated': {
        const sub = event.data.object as Stripe.Subscription;

        // Only process active subscriptions — skip past_due, unpaid, canceled
        if (sub.status !== 'active' && sub.status !== 'trialing') {
          console.log(`[Stripe webhook] Skipping subscription.updated with status "${sub.status}"`);
          break;
        }

        // ── Site subscription renewal: extend expires_at ─────────────
        if (sub.metadata?.type === 'site_subscription' && sub.metadata?.project_id) {
          const newExpiry = new Date((sub.items.data[0]?.current_period_end ?? 0) * 1000).toISOString();
          await db.projects.updateBilling(sub.metadata.project_id, {
            billing_status: 'active',
            expires_at: newExpiry,
          });
          console.log(`[Stripe webhook] Site ${sub.metadata.project_id} renewed until ${newExpiry}`);
          break;
        }

        // ── Legacy plan change ────────────────────────────────────────
        const planMeta = sub.metadata?.plan;
        const userId   = sub.metadata?.user_id;
        if (planMeta && userId) {
          await client
            .from('users')
            .update({
              plan:           planMeta,
              projects_limit: PLAN_PROJECT_LIMITS[planMeta] ?? 1,
            })
            .eq('id', userId);
        }
        break;
      }

      // ── Invoice payment failed (dunning period — card declined, insufficient funds) ──
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subId = typeof (invoice as any).subscription === 'string' ? (invoice as any).subscription : (invoice as any).subscription?.id;
        if (subId) {
          // Look up the subscription to find the project or user
          const stripeClient = new Stripe(stripeKey, { apiVersion: '2026-03-25.dahlia' });
          try {
            const sub = await stripeClient.subscriptions.retrieve(subId);
            if (sub.metadata?.type === 'site_subscription' && sub.metadata?.project_id) {
              // Mark site as past_due so the user gets a warning
              await db.projects.updateBilling(sub.metadata.project_id, {
                billing_status: 'expired',
              });
              console.log(`[Stripe webhook] Site ${sub.metadata.project_id} payment failed — marked expired`);
            }
          } catch (e) {
            console.warn('[Stripe webhook] invoice.payment_failed sub lookup error:', e);
          }
        }
        break;
      }

      // ── Subscription cancelled → expire site or downgrade/remove add-on ───
      case 'customer.subscription.deleted': {
        const sub    = event.data.object as Stripe.Subscription;

        // ── Site subscription cancelled: expire site ──────────────────
        if (sub.metadata?.type === 'site_subscription' && sub.metadata?.project_id) {
          await db.projects.updateBilling(sub.metadata.project_id, {
            billing_status: 'expired',
            site_subscription_id: null,
          });
          console.log(`[Stripe webhook] Site ${sub.metadata.project_id} expired (subscription cancelled)`);
          // Notify user about cancellation
          try {
            const { data: proj } = await client.from('projects').select('name, user_id').eq('id', sub.metadata.project_id).maybeSingle();
            if (proj?.user_id) {
              const { data: u } = await client.from('users').select('email').eq('id', proj.user_id).maybeSingle();
              if (u?.email) await sendSubscriptionCancelledEmail({ to: u.email, siteName: proj.name ?? 'Site-ul tău' });
            }
          } catch (e) { console.error('[Stripe webhook] Cancellation email error:', e); }
          break;
        }

        const userId = sub.metadata?.user_id;
        if (!userId) break;

        if (sub.metadata?.type === 'multipage_addon') {
          // Only remove if it's NOT a lifetime purchase (lifetime can't be cancelled via subscription)
          const { data: addonUser } = await client.from('users').select('multipage_addon_lifetime').eq('id', userId).single();
          if (addonUser?.multipage_addon_lifetime) {
            console.log(`[Stripe webhook] Ignoring subscription cancel for lifetime multipage user ${userId}`);
          } else {
            await client
              .from('users')
              .update({ multipage_addon: false, multipage_addon_subscription_id: null })
              .eq('id', userId);
            console.log(`[Stripe webhook] Multi-page add-on removed for user ${userId}`);
          }
        } else {
          // Plan subscription cancelled → downgrade to free
          await client
            .from('users')
            .update({ plan: 'free', projects_limit: 1 })
            .eq('id', userId);
        }
        break;
      }
    }
  } catch (e) {
    console.error('[Stripe webhook] Handler error:', e);
    return json({ error: 'Handler failed' }, 500);
  }

  return json({ received: true });
};
