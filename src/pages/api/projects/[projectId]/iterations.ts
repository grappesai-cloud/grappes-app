// Returns the iteration quota for a specific project (used + quota + remaining)
import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';

export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const used  = (project as any).iterations_used  ?? 0;
  const quota = (project as any).iterations_quota ?? 20;
  return json({
    used,
    quota,
    remaining: Math.max(0, quota - used),
  });
};
