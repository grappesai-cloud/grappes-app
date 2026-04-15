// Inbox actions: mark a submission as read or archived.
// PATCH body: { status: 'read' | 'archived' | 'new' }

import type { APIRoute } from 'astro';
import { db } from '../../../../../lib/db';
import { createAdminClient } from '../../../../../lib/supabase';
import { json } from '../../../../../lib/api-utils';

const VALID_STATUS = new Set(['new', 'read', 'archived']);

export const PATCH: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { projectId, submissionId } = params;
  if (!projectId || !submissionId) return json({ error: 'Missing params' }, 400);

  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const status = (body?.status ?? '').toString();
  if (!VALID_STATUS.has(status)) return json({ error: 'Invalid status' }, 400);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('contact_submissions')
    .update({ status })
    .eq('id', submissionId)
    .eq('project_id', projectId);

  if (error) return json({ error: error.message }, 500);
  return json({ ok: true, status });
};

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { projectId, submissionId } = params;
  if (!projectId || !submissionId) return json({ error: 'Missing params' }, 400);

  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const supabase = createAdminClient();
  const { error } = await supabase
    .from('contact_submissions')
    .delete()
    .eq('id', submissionId)
    .eq('project_id', projectId);
  if (error) return json({ error: error.message }, 500);
  return json({ ok: true });
};
