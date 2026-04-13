import type { APIRoute } from 'astro';
import { createAdminClient } from '../../../../lib/supabase';
import dns from 'dns';
import { promisify } from 'util';

import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';
const resolveCname = promisify(dns.resolveCname);


const VERCEL_CNAME_TARGETS = [
  'cname.vercel-dns.com',
  'vercel-dns.com',
  'vercel.app',
];

/**
 * GET /api/projects/[projectId]/verify-domain
 * Performs a DNS lookup to check if the project's custom_domain CNAME points to Vercel.
 * Returns { verified: boolean, status: 'verified' | 'pending' | 'failed' | 'no_domain' }
 */
export const GET: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 20 verify attempts per hour per user
  if (!checkRateLimit(`verify-domain:${user.id}`, 20, 3_600_000)) {
    return json({ error: 'Too many verification attempts. Please wait.' }, 429);
  }

  const { projectId } = params;
  const client = createAdminClient();

  // Verify project ownership
  const { data: project } = await client
    .from('projects')
    .select('id, user_id, custom_domain')
    .eq('id', projectId!)
    .maybeSingle();

  if (!project) return json({ error: 'Project not found' }, 404);
  if (project.user_id !== user.id) return json({ error: 'Forbidden' }, 403);

  const domain = project.custom_domain?.trim();
  if (!domain) {
    return json({ verified: false, status: 'no_domain' });
  }

  try {
    // Attempt CNAME lookup
    const cnames = await resolveCname(domain);
    const verified = cnames.some(cname =>
      VERCEL_CNAME_TARGETS.some(target => cname.toLowerCase().includes(target))
    );

    return json({
      verified,
      status: verified ? 'verified' : 'pending',
      cnames,
    });
  } catch (e: any) {
    // DNS lookup failed — domain doesn't exist or has no CNAME
    const code = e.code;
    if (code === 'ENOTFOUND' || code === 'ENODATA' || code === 'ESERVFAIL') {
      return json({ verified: false, status: 'pending', message: 'No DNS record found yet' });
    }
    // NONAME / other error
    return json({ verified: false, status: 'failed', message: e.message });
  }
};
