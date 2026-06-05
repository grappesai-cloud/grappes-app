// ── Studio: prompt library (built-in + user-saved) ───────────────────────────

import type { APIRoute } from 'astro';
import { getPg } from '../../../lib/supabase';
import { json } from '../../../lib/api-utils';

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const sql = getPg();
  const rows = await sql`
    SELECT id, mode, label, scene_prompt, dialogue, (user_id IS NULL) AS built_in
    FROM studio_prompts
    WHERE user_id IS NULL OR user_id = ${user.id}
    ORDER BY built_in DESC, created_at DESC
  `;
  return json({ prompts: rows });
};

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const body = await request.json().catch(() => null);
  const mode = body?.mode;
  const label = (body?.label ?? '').trim();
  const scenePrompt = (body?.scenePrompt ?? '').trim();
  const dialogue = (body?.dialogue ?? '').trim() || null;

  if (mode !== 'scene' && mode !== 'giraffe') return json({ error: 'Mod invalid.' }, 400);
  if (!label || !scenePrompt) return json({ error: 'Completează numele și descrierea scenei.' }, 400);

  const sql = getPg();
  const rows = await sql`
    INSERT INTO studio_prompts (user_id, mode, label, scene_prompt, dialogue)
    VALUES (${user.id}, ${mode}, ${label}, ${scenePrompt}, ${dialogue})
    RETURNING id
  `;
  return json({ id: rows[0].id }, 201);
};
