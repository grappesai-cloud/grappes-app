// ── Studio: step 2 — only AFTER approval. ─────────────────────────────────────
// Mode 'scene':   approved image → motion clip.
// Mode 'giraffe': dialogue → ElevenLabs TTS (synchronous) → lip-synced clip.

import type { APIRoute } from 'astro';
import { json } from '../../../../../lib/api-utils';
import { getReel, updateReel } from '../../../../../lib/studio/db';
import { generateSpeech, submitVideo } from '../../../../../lib/studio/providers';

const ALLOWED = new Set(['approved', 'video_failed']);

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const reel = await getReel(params.id!, user.id);
  if (!reel) return json({ error: 'Not found' }, 404);
  if (!ALLOWED.has(reel.status)) {
    return json({ error: 'Aprobă imaginea înainte de a genera videoul.' }, 409);
  }
  if (!reel.image_url) return json({ error: 'Lipsește imaginea aprobată.' }, 409);

  try {
    // Mode 'giraffe': voice first (sync, cheap), then the talking-head job.
    let audioUrl = reel.audio_url ?? undefined;
    if (reel.mode === 'giraffe' && !audioUrl) {
      await updateReel(reel.id, { status: 'audio_generating' },
        { stage: 'audio', msg: 'Generare voce ElevenLabs (română)' });
      audioUrl = await generateSpeech(reel.dialogue!, reel.id);
      await updateReel(reel.id, { audio_url: audioUrl },
        { stage: 'audio', msg: 'Voce generată' });
    }

    const { jobId, provider } = await submitVideo({
      imageUrl: reel.image_url,
      scenePrompt: reel.scene_prompt,
      audioUrl: reel.mode === 'giraffe' ? audioUrl : undefined,
    });
    await updateReel(reel.id, {
      status: 'video_generating',
      provider,
      provider_job_id: jobId,
      bump: 'video_attempts',
      clearError: true,
    }, { stage: 'video', msg: `Generare video pornită (${provider})` });
    return json({ ok: true });
  } catch (e: any) {
    console.error('[studio/generate-video] error:', e?.message);
    await updateReel(reel.id, { status: 'video_failed', error_message: e?.message },
      { stage: 'video', msg: `Eroare: ${e?.message}` });
    return json({ error: 'Generarea videoului a eșuat. Încearcă din nou.' }, 500);
  }
};
