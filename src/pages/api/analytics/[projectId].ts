// ─── Lightweight Analytics Endpoint ──────────────────────────────────────────
// Receives pageview beacons from generated sites.
// Stores basic metrics (url, referrer, screen width) in Supabase.
// No auth required — public endpoint called by site visitors.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';

export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const projectId = params.projectId;
  if (!projectId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(projectId)) {
    return new Response(null, { status: 400 });
  }

  // Per-IP + per-project: max 120 pageviews/hour
  const ip = getClientIp(request);
  if (!checkRateLimit(`analytics:ip:${ip}`, 120, 3_600_000)) {
    return new Response(null, { status: 204 }); // silently drop — don't reveal limit to scrapers
  }

  try {
    const body = await request.json().catch(() => ({}));
    const { url, ref, w } = body;

    const supabase = createAdminClient();

    await supabase.from('pageviews').insert({
      project_id: projectId,
      url:          typeof url === 'string' ? url.slice(0, 2000) : null,
      referrer:     typeof ref === 'string' ? ref.slice(0, 2000) : null,
      screen_width: typeof w   === 'number' ? w : null,
      created_at:   new Date().toISOString(),
    }).then(({ error }) => {
      if (error) console.warn('[analytics] Insert failed (table may not exist yet):', error.message);
    });

    return new Response(null, {
      status: 204,
      headers: { 'Access-Control-Allow-Origin': '*' },
    });
  } catch {
    return new Response(null, { status: 204 });
  }
};
