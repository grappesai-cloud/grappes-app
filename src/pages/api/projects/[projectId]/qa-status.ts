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
    .select('content, metadata')
    .eq('project_id', projectId!)
    .order('version', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!latestFile) return json({ score: null, issues: null });

  // Try to extract QA data from content (stored as JSON keyed sections)
  // Generated files may have a __visual-qa.json or __structural-qa.json key in content object
  let score: number | null = null;
  let issues: number | null = null;

  try {
    const content = latestFile.content;
    if (content && typeof content === 'object') {
      // Try visual QA key
      const visualQaRaw = (content as Record<string, string>)['__visual-qa.json']
        || (content as Record<string, string>)['__visual-qa'];
      if (visualQaRaw) {
        const parsed = typeof visualQaRaw === 'string' ? JSON.parse(visualQaRaw) : visualQaRaw;
        score = parsed.score ?? parsed.overall_score ?? null;
        issues = Array.isArray(parsed.issues) ? parsed.issues.length : (parsed.issue_count ?? null);
      }

      // Try structural QA key if visual not found
      if (score === null) {
        const structQaRaw = (content as Record<string, string>)['__structural-qa.json']
          || (content as Record<string, string>)['__structural-qa'];
        if (structQaRaw) {
          const parsed = typeof structQaRaw === 'string' ? JSON.parse(structQaRaw) : structQaRaw;
          score = parsed.score ?? null;
          issues = Array.isArray(parsed.issues) ? parsed.issues.length : (parsed.issue_count ?? 0);
        }
      }
    }

    // Also check metadata
    if (score === null && latestFile.metadata) {
      const meta = typeof latestFile.metadata === 'string'
        ? JSON.parse(latestFile.metadata) : latestFile.metadata;
      score = meta.qa_score ?? meta.score ?? null;
      issues = meta.qa_issues ?? meta.issue_count ?? null;
    }
  } catch (e) {
    console.error('[qa-status] Parse error:', e);
  }

  return json({ score, issues: issues ?? 0 });
};
