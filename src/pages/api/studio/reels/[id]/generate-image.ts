// ── Studio: step 1 — generate the still image (identity-locked for giraffe) ──

import type { APIRoute } from 'astro';
import { json } from '../../../../../lib/api-utils';
import { getReel, updateReel } from '../../../../../lib/studio/db';
import { submitImage } from '../../../../../lib/studio/providers';
import { GIRAFFE_MASTER_IMAGE } from '../../../../../lib/studio/config';

const ALLOWED = new Set(['draft', 'image_ready', 'image_failed']); // image_ready = regenerate before approval

export const POST: APIRoute = async ({ locals, params, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const reel = await getReel(params.id!, user.id);
  if (!reel) return json({ error: 'Not found' }, 404);
  if (!ALLOWED.has(reel.status)) {
    return json({ error: `Nu pot genera imagine din starea "${reel.status}".` }, 409);
  }

  try {
    const withGiraffe = reel.mode === 'giraffe';
    const { jobId, provider } = await submitImage({
      scenePrompt: reel.scene_prompt,
      withGiraffe,
      refImageUrl: withGiraffe ? new URL(GIRAFFE_MASTER_IMAGE, url.origin).toString() : undefined,
    });
    await updateReel(reel.id, {
      status: 'image_generating',
      provider,
      provider_job_id: jobId,
      bump: 'image_attempts',
      clearError: true,
    }, { stage: 'image', msg: `Generare imagine pornită (${provider}), încercarea ${reel.image_attempts + 1}` });
    return json({ ok: true });
  } catch (e: any) {
    console.error('[studio/generate-image] error:', e?.message);
    await updateReel(reel.id, { status: 'image_failed', error_message: e?.message },
      { stage: 'image', msg: `Eroare la pornire: ${e?.message}` });
    return json({ error: 'Generarea imaginii a eșuat. Încearcă din nou.' }, 500);
  }
};
