// ── Studio: reel status — also advances async provider jobs on each poll ─────
//
// Serverless-friendly: no background worker. The client polls this endpoint;
// when a generation job is in flight we ask the provider, and on completion we
// archive the artifact into Vercel Blob and advance the pipeline state.

import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api-utils';
import { getReel, updateReel } from '../../../../lib/studio/db';
import { pollImage, pollVideo, archiveToBlob } from '../../../../lib/studio/providers';

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  let reel = await getReel(params.id!, user.id);
  if (!reel) return json({ error: 'Not found' }, 404);

  try {
    if (reel.status === 'image_generating' && reel.provider && reel.provider_job_id) {
      const st = await pollImage(reel.provider, reel.provider_job_id);
      if (st.state === 'complete') {
        const url = await archiveToBlob(st.url, `studio/${reel.id}/image.jpg`, 'image/jpeg');
        await updateReel(reel.id, { status: 'image_ready', image_url: url, clearError: true },
          { stage: 'image', msg: 'Imagine generată, așteaptă aprobare' });
      } else if (st.state === 'failed') {
        await updateReel(reel.id, { status: 'image_failed', error_message: st.error },
          { stage: 'image', msg: `Eroare: ${st.error}` });
      }
    } else if (reel.status === 'video_generating' && reel.provider && reel.provider_job_id) {
      const st = await pollVideo(reel.provider, reel.provider_job_id);
      if (st.state === 'complete') {
        const url = await archiveToBlob(st.url, `studio/${reel.id}/reel.mp4`, 'video/mp4');
        await updateReel(reel.id, { status: 'complete', video_url: url, clearError: true },
          { stage: 'video', msg: 'Reel finalizat' });
      } else if (st.state === 'failed') {
        await updateReel(reel.id, { status: 'video_failed', error_message: st.error },
          { stage: 'video', msg: `Eroare: ${st.error}` });
      }
    }
  } catch (e: any) {
    console.error('[studio/status] poll error:', e?.message);
    // Leave state as-is; client keeps polling.
  }

  reel = await getReel(params.id!, user.id);
  return json({ reel });
};
