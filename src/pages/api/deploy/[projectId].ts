import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import {
  getLatestDeployment,
} from '../../../lib/vercel-api';
import { runVisualQA } from '../../../lib/visual-qa';
import { json } from '../../../lib/api-utils';

// ─── GET — poll current deployment status ─────────────────────────────────────

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const latestDeploy = await db.deployments.findLatest(params.projectId!);

  // If deploying, sync status from Vercel
  if (
    latestDeploy &&
    project.status === 'deploying' &&
    project.vercel_project_id
  ) {
    const vercelDep = await getLatestDeployment(project.vercel_project_id);

    if (vercelDep) {
      const stateMap: Record<string, string> = {
        QUEUED: 'queued',
        BUILDING: 'building',
        READY: 'ready',
        ERROR: 'error',
        CANCELED: 'canceled',
      };
      const mapped = stateMap[vercelDep.state] ?? 'building';

      if (mapped !== latestDeploy.status) {
        await db.deployments.updateStatus(latestDeploy.id, mapped as any, {
          preview_url: vercelDep.url || undefined,
        });

        if (mapped === 'ready') {
          await db.projects.updateStatus(params.projectId!, 'live');
          await db.projects.update(params.projectId!, { preview_url: vercelDep.url });

          // Fire visual QA in background — non-blocking, stores results in generated_files
          if (vercelDep.url) {
            runVisualQA(params.projectId!, `https://${vercelDep.url}`).catch(e =>
              console.error('[visual-qa] background run failed:', e)
            );
          }
        } else if (mapped === 'error') {
          await db.projects.updateStatus(params.projectId!, 'failed');
        }
      }
    }
  }

  // Re-fetch after potential update
  const updatedProject = await db.projects.findById(params.projectId!);
  const updatedDeploy = await db.deployments.findLatest(params.projectId!);

  return json({
    projectStatus: updatedProject?.status,
    deployment: updatedDeploy
      ? {
          id: updatedDeploy.id,
          status: updatedDeploy.status,
          preview_url: updatedDeploy.preview_url,
          error_message: updatedDeploy.error_message,
          created_at: updatedDeploy.created_at,
          completed_at: updatedDeploy.completed_at,
        }
      : null,
    previewUrl: updatedProject?.preview_url,
    githubUrl: updatedProject?.github_url,
  });
};

// ─── POST — delegates to the unified publish pipeline ────────────────────────
// Previously this was a duplicate implementation. Now it forwards to publish.ts
// which handles GitHub push, Vercel project creation, deployment trigger, and polling.

export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  if (!['generated', 'failed', 'live'].includes(project.status)) {
    return json({ error: `Cannot deploy from status "${project.status}". Generate files first.` }, 409);
  }

  if (project.billing_status === 'expired') {
    return json({ error: 'Your site plan has expired. Please renew to deploy.' }, 403);
  }

  // Forward to the canonical publish endpoint
  const origin = new URL(request.url).origin;
  const publishRes = await fetch(`${origin}/api/projects/${params.projectId}/publish`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      cookie: request.headers.get('cookie') ?? '',
    },
  });

  const data = await publishRes.json();
  return json(data, publishRes.status);
};
