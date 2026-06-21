// ── GET /api/brandbook/[id]/html — full document HTML for the in-app viewer ──

import type { APIRoute } from 'astro';
import { json } from '../../../../lib/api-utils';
import { loadBrandBook, toDoc, renderBookHTML } from '../../../../lib/brandbook-db';

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Sign in first.' }, 401);

  const row = await loadBrandBook(params.id as string, user.id);
  const doc = row && toDoc(row, { downloads: true });
  if (!doc) return json({ error: 'Brand book not found.' }, 404);

  return new Response(renderBookHTML(row, doc), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'private, no-store',
      // Same-origin iframe only.
      'X-Frame-Options': 'SAMEORIGIN',
      'Content-Security-Policy': "frame-ancestors 'self'",
    },
  });
};
