import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import type { AssetType } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';


export const GET: APIRoute = async ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const typeFilter = url.searchParams.get('type') as AssetType | null;

  const assets = typeFilter
    ? await db.assets.findByProjectAndType(params.projectId!, typeFilter)
    : await db.assets.findByProject(params.projectId!);

  return json({ assets });
};
