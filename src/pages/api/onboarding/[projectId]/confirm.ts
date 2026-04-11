import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { applySmartDefaults, calculateCompleteness } from '../../../../lib/onboarding';
import { json } from '../../../../lib/api-utils';


export const POST: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const brief = await db.briefs.findByProjectId(params.projectId!);
    if (!brief) return json({ error: 'Brief not found' }, 404);

    // Fill any missing fields with smart industry defaults
    const enrichedData = applySmartDefaults(brief.data);
    const completeness = calculateCompleteness(enrichedData);

    // Persist enriched data
    await db.briefs.update(params.projectId!, enrichedData, completeness);

    // Mark brief as confirmed
    const confirmed = await db.briefs.confirm(params.projectId!);

    // Advance project to brief_ready so generation can be triggered
    await db.projects.updateStatus(params.projectId!, 'brief_ready');

    return json({ brief: confirmed, completeness });
  } catch (e) {
    console.error('[POST /api/onboarding/:projectId/confirm]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
