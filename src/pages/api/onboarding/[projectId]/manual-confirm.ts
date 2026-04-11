// ── Manual brief confirm ──────────────────────────────────────────────────────
// Receives the full brief data from the manual form, saves it, and confirms.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { applySmartDefaults, calculateCompleteness } from '../../../../lib/onboarding';
import { createAdminClient } from '../../../../lib/supabase';
import { json } from '../../../../lib/api-utils';


export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    let body: any;
    try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
    const rawData: Record<string, any> = body.data ?? {};

    // Enrich with smart defaults and calculate completeness
    const enrichedData = applySmartDefaults(rawData);
    const completeness = calculateCompleteness(enrichedData);

    const client = createAdminClient();

    // Upsert brief
    const existing = await db.briefs.findByProjectId(params.projectId!);
    if (existing) {
      await db.briefs.update(params.projectId!, enrichedData, completeness);
    } else {
      await client.from('briefs').insert({
        project_id: params.projectId!,
        data: enrichedData,
        completeness,
        confirmed: false,
      });
    }

    // Confirm and advance project status
    const confirmed = await db.briefs.confirm(params.projectId!);
    await db.projects.updateStatus(params.projectId!, 'brief_ready');

    return json({ brief: confirmed, completeness });
  } catch (e) {
    console.error('[POST /api/onboarding/:projectId/manual-confirm]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
