// Lightweight brief snapshot for the live preview panel.
// Read-only; authenticated + ownership-scoped.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const projectId = params.projectId;
  if (!projectId) return json({ error: 'Missing projectId' }, 400);

  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const brief = await db.briefs.findByProjectId(projectId);
  return json({
    ok: true,
    completeness: brief?.completeness ?? 0,
    data: brief?.data ?? {},
  });
};
