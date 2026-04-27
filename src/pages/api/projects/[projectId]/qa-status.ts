import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase';
import { json } from '../../../../lib/api-utils';


/**
 * GET /api/projects/[projectId]/qa-status
 * Returns { score, issues } from the latest generated file's QA data.
 */
export const GET: APIRoute = async ({ params, locals }) => {
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

  // Get latest generated file
  const { data: latestFile } = await client
    .from('generated_files')
    .select('files')
    .eq('project_id', projectId!)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestFile) return json({ score: null, issues: null, postIssues: [], verdict: null });

  let score:      number | null = null;
  let issueCount: number        = 0;
  let postIssues: any[]         = [];
  let verdict:    string | null = null;

  try {
    const files = latestFile.files;
    if (files && typeof files === 'object') {
      // Brief-aware post-QA wins (most informative, matches the brief)
      const postRaw = (files as Record<string, string>)['__post-qa.json'];
      if (postRaw) {
        const parsed = typeof postRaw === 'string' ? JSON.parse(postRaw) : postRaw;
        score      = typeof parsed.score === 'number' ? parsed.score : null;
        postIssues = Array.isArray(parsed.issues) ? parsed.issues : [];
        verdict    = parsed.haikuVerdict ?? null;
        issueCount = postIssues.length;
      }

      // Fallback to structural QA score if no post-QA report exists
      if (score === null) {
        const structRaw = (files as Record<string, string>)['__structural-qa.json'];
        if (structRaw) {
          const parsed = typeof structRaw === 'string' ? JSON.parse(structRaw) : structRaw;
          score      = parsed.score ?? null;
          issueCount = Array.isArray(parsed.checks) ? parsed.checks.filter((c: any) => !c.passed).length : 0;
        }
      }
    }
  } catch (e) {
    console.error('[qa-status] Parse error:', e);
  }

  return json({ score, issues: issueCount, postIssues, verdict });
};
