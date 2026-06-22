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
  // Raw, unedited onboarding Q&A — the exact questions + the client's answers.
  const convo = await db.conversations.findByProjectId(projectId).catch(() => null);

  // All media the client uploaded at onboarding (photos, logo, video) — the
  // operator downloads these to build the site by hand.
  let assets: Array<Record<string, any>> = [];
  try {
    const rows = await db.assets.findByProject(projectId);
    assets = rows
      .filter((a: any) => a.public_url)
      .map((a: any) => ({
        id: a.id,
        type: a.type,
        url: a.public_url,
        filename: a.filename ?? null,
        mime: a.mime_type ?? null,
        sizeBytes: a.size_bytes ?? null,
        // section tag / responsive variants / video play mode, if present
        sectionId: a.metadata?.sectionId ?? null,
        playMode: a.metadata?.playMode ?? null,
        variants: a.metadata?.variants ?? null,
      }));
  } catch (e) {
    console.error('[admin/brief] asset load failed:', e);
  }

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
    // Raw onboarding transcript (exact Q&A), unmodified — the source of truth.
    conversation: (convo?.messages ?? []).map((m: any) => ({ role: m.role, content: m.content, timestamp: m.timestamp })),
    // Structured/summarized brief — derived from the conversation, lossy.
    brief: brief?.data ?? null,
    assets,
    assetCount: assets.length,
  });
};
