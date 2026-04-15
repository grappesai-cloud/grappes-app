import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { db } from '../../../lib/db';
import type { DeploymentStatus } from '../../../lib/db';
import { sendSiteLiveEmail, sendDeploymentFailedEmail, sendTrialStartedEmail } from '../../../lib/resend';
import { log } from '../../../lib/logger';
import { json } from '../../../lib/api-utils';


// Map Vercel deployment states to our DeploymentStatus
const STATE_MAP: Record<string, DeploymentStatus> = {
  QUEUED: 'queued',
  BUILDING: 'building',
  READY: 'ready',
  ERROR: 'error',
  CANCELED: 'canceled',
};

export const POST: APIRoute = async ({ request }) => {
  try {
    // Verify Vercel HMAC-SHA1 signature
    const signature = request.headers.get('x-vercel-signature');
    const secret    = import.meta.env.VERCEL_WEBHOOK_SECRET;
    const rawBody   = await request.text();

    if (!secret) return json({ error: 'VERCEL_WEBHOOK_SECRET not configured' }, 500);
    if (!signature) return json({ error: 'Missing signature' }, 401);
    const expected = createHmac('sha1', secret).update(rawBody).digest('hex');
    const sigBuf = Buffer.from(signature);
    const expBuf = Buffer.from(expected);
    if (sigBuf.length !== expBuf.length || !timingSafeEqual(sigBuf, expBuf)) return json({ error: 'Invalid signature' }, 401);

    const payload = JSON.parse(rawBody);
    const { type, payload: data } = payload;

    if (type !== 'deployment') return json({ ok: true });

    const vercelProjectId = data?.project?.id;
    const state: string = data?.deployment?.readyState || data?.deployment?.state || '';
    const deploymentUrl: string = data?.deployment?.url ? `https://${data.deployment.url}` : '';
    const errorMessage: string = data?.deployment?.errorMessage || '';

    if (!vercelProjectId || !state) return json({ ok: true });

    // Find project by Vercel project ID
    const { createAdminClient } = await import('../../../lib/supabase');
    const supabase = createAdminClient();

    const { data: project } = await supabase
      .from('projects')
      .select('id, status, billing_status')
      .eq('vercel_project_id', vercelProjectId)
      .maybeSingle();

    if (!project) return json({ ok: true });

    const mappedStatus = STATE_MAP[state.toUpperCase()];
    if (!mappedStatus) return json({ ok: true });

    // Update latest deployment record (with idempotency — skip if already at terminal state)
    const latestDeploy = await db.deployments.findLatest(project.id);
    if (latestDeploy) {
      const terminalStates: string[] = ['ready', 'error', 'canceled'];
      if (terminalStates.includes(latestDeploy.status) && latestDeploy.status === mappedStatus) {
        // Already processed this terminal state — skip to avoid duplicate emails
        return json({ ok: true, skipped: 'already_processed' });
      }
      await db.deployments.updateStatus(latestDeploy.id, mappedStatus, {
        preview_url: deploymentUrl || undefined,
        error_message: errorMessage || undefined,
      });
    }

    // Update project status — single atomic write avoids live+no-preview_url partial state
    if (mappedStatus === 'ready') {
      const { getFreeExpiresAt } = await import('../../../lib/site-billing');
      await supabase.from('projects').update({
        status: 'live',
        preview_url: deploymentUrl || null,
        deployed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        substatus: null,
        // Set 7-day expiry for free deployments
        ...(project.billing_status === 'free' && { expires_at: getFreeExpiresAt() }),
      }).eq('id', project.id);
      // Send "site is live" email via Resend
      try {
        const { data: fullProject } = await supabase
          .from('projects')
          .select('name, user_id')
          .eq('id', project.id)
          .maybeSingle();
        if (fullProject?.user_id) {
          const { data: userRow } = await supabase
            .from('users')
            .select('email')
            .eq('id', fullProject.user_id)
            .maybeSingle();
          if (userRow?.email && deploymentUrl) {
            await sendSiteLiveEmail({
              to: userRow.email,
              siteName: fullProject.name ?? 'Site-ul tău',
              siteUrl: deploymentUrl,
            });
            // Send trial-started email for free deployments
            if (project.billing_status === 'free') {
              const { getFreeExpiresAt } = await import('../../../lib/site-billing');
              await sendTrialStartedEmail({
                to: userRow.email,
                siteName: fullProject.name ?? 'Site-ul tău',
                siteUrl: deploymentUrl,
                expiresAt: getFreeExpiresAt(),
              });
            }
          }
        }
      } catch (emailErr) {
        console.error('[vercel webhook] Site live email failed:', emailErr);
      }
    } else if (mappedStatus === 'error') {
      await db.projects.updateStatus(project.id, 'failed');
      // Send failure notification email
      try {
        const { data: failedProject } = await supabase.from('projects').select('name, user_id').eq('id', project.id).maybeSingle();
        if (failedProject?.user_id) {
          const { data: userRow } = await supabase.from('users').select('email').eq('id', failedProject.user_id).maybeSingle();
          if (userRow?.email) {
            await sendDeploymentFailedEmail({ to: userRow.email, siteName: failedProject.name ?? 'Site-ul tău', error: errorMessage || undefined });
          }
        }
      } catch (e) { console.error('[vercel webhook] Failure email error:', e); }
    }

    return json({ ok: true });
  } catch (e) {
    console.error('[POST /api/webhooks/vercel]', e);
    return json({ error: 'Webhook processing failed' }, 500);
  }
};
