// POST /api/admin/projects/[projectId]/retry
// Re-enqueues a failed project for generation.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { verifyAdminSession } from '../../../../../lib/admin-auth';
import { json } from '../../../../../lib/api-utils';

export const POST: APIRoute = async ({ cookies, params, url }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);
  const projectId = params.projectId;
  if (!projectId) return json({ error: 'missing projectId' }, 400);

  const client = createAdminClient();
  const { data: project } = await client
    .from('projects')
    .select('id, name, status, user_id')
    .eq('id', projectId)
    .maybeSingle();
  if (!project) return json({ error: 'Project not found' }, 404);

  // Reset status so the generation pipeline will pick it up again
  const { error } = await client.from('projects')
    .update({ status: 'brief_ready', updated_at: new Date().toISOString() })
    .eq('id', projectId);
  if (error) return json({ error: error.message }, 500);

  // Fire the launch pipeline (don't await — it takes minutes)
  const siteUrl = import.meta.env.PUBLIC_SITE_URL ?? new URL(url.toString()).origin;
  fetch(`${siteUrl}/api/projects/${projectId}/launch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-admin-retry': 'true' },
  }).catch(e => console.warn('[admin/retry] launch kick failed:', e));

  return json({ ok: true, projectId, status: 'brief_ready' });
};
