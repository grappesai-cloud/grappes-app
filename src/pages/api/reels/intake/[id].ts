// Intake answers submission for a queued reel analysis.
// The pipeline waits for these answers before running the AI analysis step.

import type { APIRoute } from 'astro';
import { findAnalysis } from '../../../../lib/reels/db';
import { sql } from '../../../../db';
import { json } from '../../../../lib/api-utils';
import type { IntakeAnswers, ProcessingProgress } from '../../../../lib/reels/types';

export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'unauthorized' }, 401);
  if (!params.id) return json({ error: 'missing id' }, 400);

  const body = (await request.json().catch(() => ({}))) as { answers?: IntakeAnswers };
  if (!body.answers || typeof body.answers !== 'object') {
    return json({ error: "missing 'answers' object" }, 400);
  }

  const row = await findAnalysis(params.id);
  if (!row) return json({ error: 'not found' }, 404);
  if (row.userId !== user.id) return json({ error: 'not found' }, 404);

  const progress = row.progress as ProcessingProgress | null;
  if (!progress?.intake) return json({ error: 'intake not in awaiting state' }, 409);

  // Merge intake_answers onto the progress jsonb so the pipeline picks them up.
  const newProgress = JSON.stringify({ ...progress, intake_answers: body.answers });
  await sql`
    UPDATE reel_analyses
    SET progress = ${newProgress}::jsonb,
        updated_at = now()
    WHERE id = ${params.id}
  `;
  return json({ ok: true });
};
