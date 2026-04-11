import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';


export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    await db.projects.archive(params.projectId!);
    return json({ success: true });
  } catch (e) {
    console.error('[POST /api/projects/:id/delete]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
