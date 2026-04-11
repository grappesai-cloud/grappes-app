// ── Health check endpoint ────────────────────────────────────────────────────
// Returns 200 with basic system info for uptime monitors and load balancers.
// No auth required — public endpoint.

import type { APIRoute } from 'astro';
import { createAdminClient } from '../../lib/supabase';

export const GET: APIRoute = async () => {
  const start = Date.now();
  let dbOk = false;

  try {
    const client = createAdminClient();
    const { error } = await client.from('users').select('id', { count: 'exact', head: true }).limit(0);
    dbOk = !error;
  } catch {}

  const status = dbOk ? 'healthy' : 'degraded';
  const httpStatus = dbOk ? 200 : 503;

  return new Response(JSON.stringify({
    status,
    timestamp: new Date().toISOString(),
    latency_ms: Date.now() - start,
    services: { database: dbOk ? 'ok' : 'unreachable' },
  }), {
    status: httpStatus,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    },
  });
};
