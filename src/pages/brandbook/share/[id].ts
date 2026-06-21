// ── GET /brandbook/share/[id]?t=<token> — public, read-only brand book ────────
// Anyone with the signed link can view the book (no account). Public prefix in
// middleware; access is gated by the HMAC token, not a session.

import type { APIRoute } from 'astro';
import { loadBrandBookPublic, toDoc, renderBookHTML } from '../../../lib/brandbook-db';
import { verifyBrandbookShareToken } from '../../../lib/brandbook-share';

export const GET: APIRoute = async ({ params, url }) => {
  const id = params.id as string;
  const token = url.searchParams.get('t') || '';
  if (!id || !verifyBrandbookShareToken(id, token)) {
    return new Response('Not found', { status: 404 });
  }

  const row = await loadBrandBookPublic(id);
  const doc = row && toDoc(row); // no downloads section in the public view
  if (!doc) return new Response('Not found', { status: 404 });

  return new Response(renderBookHTML(row, doc), {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
};
