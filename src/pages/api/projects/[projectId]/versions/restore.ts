import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../../lib/supabase';
import { json } from '../../../../../lib/api-utils';


/**
 * POST /api/projects/[projectId]/versions/restore
 * Body: { version: number }
 * Restores a specific version by duplicating it as the newest version.
 */
export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const { projectId } = params;
  const client = createAdminClient();

  // Verify project ownership
  const { data: project } = await client
    .from('projects')
    .select('id, user_id')
    .eq('id', projectId!)
    .maybeSingle();

  if (!project) return json({ error: 'Project not found' }, 404);
  if (project.user_id !== user.id) return json({ error: 'Forbidden' }, 403);

  let body: { version?: number };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const targetVersion = body.version;
  if (typeof targetVersion !== 'number') {
    return json({ error: 'version must be a number' }, 400);
  }

  // Find the target version
  const { data: targetFile } = await client
    .from('generated_files')
    .select('*')
    .eq('project_id', projectId!)
    .eq('version', targetVersion)
    .maybeSingle();

  if (!targetFile) return json({ error: 'Version not found' }, 404);

  // Get current max version
  const { data: maxRow } = await client
    .from('generated_files')
    .select('version')
    .eq('project_id', projectId!)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  const newVersion = (maxRow?.version ?? 0) + 1;

  // Insert duplicate as new version (restore)
  const { error: insertError } = await client
    .from('generated_files')
    .insert({
      project_id:        projectId!,
      version:           newVersion,
      files:             targetFile.files,
      generation_cost:   0,
      generation_tokens: 0,
    });

  if (insertError) {
    console.error('[POST /versions/restore]', insertError);
    return json({ error: 'Failed to restore version' }, 500);
  }

  return json({ ok: true, newVersion });
};
