import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';
import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';


const VERCEL_NAMESERVERS = ['ns1.vercel-dns.com', 'ns2.vercel-dns.com'];

/**
 * POST /api/projects/[projectId]/domain
 * Body: { domain: string }
 *
 * Saves the custom domain to the project and registers it on the Vercel project.
 * Returns the nameservers the client must set at their registrar.
 */
export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 10 domain operations per hour per user
  if (!checkRateLimit(`domain:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'Too many domain requests. Please wait.' }, 429);
  }

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  if (project.status !== 'live') {
    return json({ error: 'Site must be live before adding a custom domain.' }, 409);
  }

  const body = await request.json().catch(() => ({}));
  const raw: string = body.domain ?? '';
  // Normalise: lowercase, strip protocol, strip trailing slash
  const domain = raw.toLowerCase().replace(/^https?:\/\//i, '').replace(/\/.*$/, '').trim();

  if (!domain || !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) {
    return json({ error: 'Invalid domain name.' }, 400);
  }

  // Save to DB first (best-effort Vercel call below)
  const supabase = createAdminClient();
  await supabase
    .from('projects')
    .update({ custom_domain: domain, domain_verified: false, updated_at: new Date().toISOString() })
    .eq('id', params.projectId!);

  // Register domain on Vercel project (non-fatal if fails)
  const vercelError = await addDomainToVercel(project.vercel_project_id, domain);

  return json({
    ok: true,
    domain,
    nameservers: VERCEL_NAMESERVERS,
    vercelError: vercelError ?? null,
  });
};

/**
 * DELETE /api/projects/[projectId]/domain
 * Removes the custom domain from the project (DB only — Vercel removal is manual for now).
 */
export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const supabase = createAdminClient();
  await supabase
    .from('projects')
    .update({ custom_domain: null, domain_verified: false, updated_at: new Date().toISOString() })
    .eq('id', params.projectId!);

  return json({ ok: true });
};

// ── Vercel helper ──────────────────────────────────────────────────────────────

async function addDomainToVercel(vercelProjectId: string | null | undefined, domain: string): Promise<string | null> {
  if (!vercelProjectId) return 'No Vercel project linked yet.';

  const BASE = 'https://api.vercel.com';
  const token = import.meta.env.VERCEL_TOKEN;
  const teamId = import.meta.env.VERCEL_TEAM_ID;
  if (!token) return 'VERCEL_TOKEN not configured.';

  const qs = teamId ? `?teamId=${teamId}` : '';

  try {
    const res = await fetch(`${BASE}/v9/projects/${encodeURIComponent(vercelProjectId)}/domains${qs}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: domain }),
    });

    if (res.ok) return null; // success

    const err = await res.json().catch(() => ({}));
    // "domain already added" is not a real error
    if (err?.error?.code === 'domain_already_added') return null;
    return err?.error?.message ?? `Vercel API error ${res.status}`;
  } catch (e) {
    return (e as Error).message;
  }
}
