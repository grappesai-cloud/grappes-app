import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { createAdminClient } from '../../../lib/supabase';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


function generateSlug(name: string): string {
  return (
    name
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .substring(0, 50) || 'project'
  );
}

export const GET: APIRoute = async ({ locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const projects = await db.projects.findByUser(user.id);
    return json(projects);
  } catch (e) {
    console.error('[GET /api/projects]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 10 project creations/hour per user
  if (!checkRateLimit(`create-project:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'Too many requests. Please wait before creating another project.' }, 429);
  }

  try {
    const body = await request.json().catch(() => null);
    const name = body?.name?.trim();
    if (!name) return json({ error: 'name is required' }, 400);

    // Fetch user profile for plan limit check
    const dbUser = await db.users.findById(user.id);
    if (!dbUser) return json({ error: 'User profile not found' }, 404);

    // Free-tier users: max 1 unactivated (free) site at a time
    if (dbUser.plan === 'free') {
      const freeCount = await db.projects.countFree(user.id);
      if (freeCount >= 1) {
        return json(
          { error: 'Ai deja un site gratuit. Activează-l pentru a crea altul.' },
          403
        );
      }
    }

    // Enforce plan limit
    const count = await db.projects.countByUser(user.id);
    if (count >= dbUser.projects_limit) {
      return json(
        { error: 'Project limit reached. Upgrade your plan to create more projects.' },
        403
      );
    }

    // Generate unique slug per user
    let slug = generateSlug(name);
    let attempt = 0;
    while (await db.projects.slugExists(slug, user.id)) {
      attempt++;
      slug = `${generateSlug(name)}-${attempt}`;
    }

    // Create project + brief + conversation (with rollback on partial failure)
    const supabase = createAdminClient();

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert({ user_id: user.id, name, slug })
      .select('*')
      .single();

    if (projErr) throw projErr;

    const { error: briefErr } = await supabase.from('briefs').insert({ project_id: project.id });
    if (briefErr) {
      // Rollback: delete the orphaned project
      await supabase.from('projects').delete().eq('id', project.id);
      throw briefErr;
    }

    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .insert({ project_id: project.id })
      .select('id')
      .single();

    if (convErr) {
      // Rollback: delete brief and project
      await supabase.from('briefs').delete().eq('project_id', project.id);
      await supabase.from('projects').delete().eq('id', project.id);
      throw convErr;
    }

    return json(
      {
        project: { id: project.id, slug: project.slug, status: project.status },
        conversationId: conversation.id,
      },
      201
    );
  } catch (e: any) {
    console.error('[POST /api/projects] ERROR:', e?.message ?? e, e?.code ?? '', e?.details ?? '', e?.hint ?? '');
    return json({ error: 'Internal server error', debug: e?.message ?? String(e) }, 500);
  }
};
