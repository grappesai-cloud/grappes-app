// ─── Admin: read a project's brief (concierge flow) ──────────────────────────
// Lets the operator pull the onboarding brief for a project to build it by hand.
// Auth: x-admin-secret header === ADMIN_SECRET.
//   curl -H "x-admin-secret: $S" https://grappes.dev/api/admin/projects/<id>/brief

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { db } from '../../../../../lib/db';
import { json } from '../../../../../lib/api-utils';
import { checkRateLimit, getClientIp } from '../../../../../lib/rate-limit';

export const GET: APIRoute = async ({ request, params }) => {
  if (!checkRateLimit(`admin:${getClientIp(request)}`, 60, 3_600_000)) {
    return json({ error: 'Too many requests' }, 429);
  }
  const secret = request.headers.get('x-admin-secret') ?? '';
  const adminSecret = import.meta.env.ADMIN_SECRET ?? '';
  const ok = adminSecret !== '' && (() => {
    try { return timingSafeEqual(Buffer.from(secret), Buffer.from(adminSecret)); } catch { return false; }
  })();
  if (!ok) return json({ error: 'Unauthorized' }, 401);

  const projectId = params.projectId!;
  const project = await db.projects.findById(projectId);
  if (!project) return json({ error: 'Project not found' }, 404);

  const brief = await db.briefs.findByProjectId(projectId);
  const owner = project.user_id ? await db.users.findById(project.user_id) : null;

  return json({
    projectId,
    name: project.name,
    slug: (project as any).slug ?? null,
    status: project.status,
    substatus: (project as any).substatus ?? null,
    clientEmail: (owner as any)?.email ?? null,
    clientName: (owner as any)?.name ?? null,
    completeness: brief?.completeness ?? null,
    confirmed: brief?.confirmed ?? null,
    brief: brief?.data ?? null,
  });
};
