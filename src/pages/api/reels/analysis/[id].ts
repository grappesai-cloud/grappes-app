// Status polling endpoint for a single reel analysis.

import type { APIRoute } from 'astro';
import { findAnalysis } from '../../../../lib/reels/db';
import { json } from '../../../../lib/api-utils';

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in.' }, 401);
  if (!params.id) return json({ error: 'missing id' }, 400);

  const row = await findAnalysis(params.id);
  if (!row) return json({ error: 'not found' }, 404);
  if (row.userId !== user.id) return json({ error: 'not found' }, 404);

  return json(row);
};
