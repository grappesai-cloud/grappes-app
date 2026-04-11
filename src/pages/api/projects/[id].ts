import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { json } from '../../../lib/api-utils';


async function verifyOwnership(projectId: string, userId: string) {
  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== userId) return null;
  return project;
}

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await verifyOwnership(params.id!, user.id);
    if (!project) return json({ error: 'Not found' }, 404);

    const [brief, latestDeployment] = await Promise.all([
      db.briefs.findByProjectId(project.id),
      db.deployments.findLatest(project.id),
    ]);

    return json({ ...project, brief, latestDeployment });
  } catch (e) {
    console.error('[GET /api/projects/:id]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await verifyOwnership(params.id!, user.id);
    if (!project) return json({ error: 'Not found' }, 404);

    const body = await request.json().catch(() => ({}));
    const updates: Record<string, any> = {};
    if (typeof body.name === 'string' && body.name.trim()) updates.name = body.name.trim();
    if (body.custom_domain !== undefined) updates.custom_domain = body.custom_domain || null;

    if (Object.keys(updates).length === 0) return json({ error: 'No valid fields to update' }, 400);

    const updated = await db.projects.update(params.id!, updates as any);
    return json(updated);
  } catch (e) {
    console.error('[PATCH /api/projects/:id]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await verifyOwnership(params.id!, user.id);
    if (!project) return json({ error: 'Not found' }, 404);

    await db.projects.archive(params.id!);
    return json({ success: true });
  } catch (e) {
    console.error('[DELETE /api/projects/:id]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
