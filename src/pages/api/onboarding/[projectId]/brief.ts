import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';


export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const brief = await db.briefs.findByProjectId(params.projectId!);
    return json(brief ?? { data: {}, completeness: 0, confirmed: false });
  } catch (e) {
    console.error('[GET /api/onboarding/:projectId/brief]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
