// ── POST /api/reels/analysis/[id]/share ───────────────────────────────────────
// Toggle public sharing for a reel analysis. Owner only. Returns the public URL.

import type { APIRoute } from 'astro';
import { json } from '../../../../../lib/api-utils';
import { setAnalysisPublic, findAnalysis } from '../../../../../lib/reels/db';

export const POST: APIRoute = async ({ locals, params, request, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const id = params.id as string;
  if (!id) return json({ error: 'Missing id.' }, 400);

  let body: { public?: boolean };
  try {
    body = (await request.json()) as { public?: boolean };
  } catch {
    return json({ error: 'Invalid JSON body.' }, 400);
  }
  const makePublic = body.public !== false; // default true

  // Only completed analyses can be shared publicly.
  if (makePublic) {
    const row = await findAnalysis(id);
    if (!row || row.userId !== user.id) return json({ error: 'Not found.' }, 404);
    if (row.status !== 'done') return json({ error: 'Analysis is not ready yet.' }, 409);
  }

  const result = await setAnalysisPublic(id, user.id, makePublic);
  if (result === null) return json({ error: 'Not found.' }, 404);

  return json({
    ok: true,
    isPublic: result,
    url: result ? `${url.origin}/reels/share/${id}` : null,
  });
};
