import type { APIRoute } from 'astro';
import { json } from '../../../lib/api-utils';


/**
 * GET /api/domains/check?name=domeniu.com
 * Checks domain availability and price via Vercel API.
 */
export const GET: APIRoute = async ({ request, locals }) => {
  if (!locals.user) return json({ error: 'Unauthorized' }, 401);

  const url = new URL(request.url);
  const name = url.searchParams.get('name')?.toLowerCase().trim();

  if (!name || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(name)) {
    return json({ error: 'Invalid domain name.' }, 400);
  }

  const token  = import.meta.env.VERCEL_TOKEN;
  const teamId = import.meta.env.VERCEL_TEAM_ID;
  if (!token) return json({ error: 'Vercel not configured.' }, 503);

  const qs = teamId ? `&teamId=${teamId}` : '';

  try {
    const res = await fetch(
      `https://api.vercel.com/v4/domains/status?name=${encodeURIComponent(name)}${qs}`,
      { headers: { Authorization: `Bearer ${token}` } }
    );

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      return json({ error: err?.error?.message ?? `Vercel API error ${res.status}` }, res.status);
    }

    const data = await res.json();
    // data: { available: boolean, price?: number, premium?: boolean, period?: number }
    return json({
      available: data.available ?? false,
      price:     data.price ?? null,       // USD/year
      premium:   data.premium ?? false,
      period:    data.period ?? 1,          // years
    });
  } catch (e) {
    return json({ error: (e as Error).message }, 500);
  }
};
