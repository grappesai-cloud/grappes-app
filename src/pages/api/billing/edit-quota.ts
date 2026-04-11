// Returns the current user's edit quota (for UI display, no consumption)
import type { APIRoute } from 'astro';
import { getEditQuota } from '../../../lib/edit-quota';
import { json } from '../../../lib/api-utils';


export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const quota = await getEditQuota(user.id);
  return json(quota);
};
