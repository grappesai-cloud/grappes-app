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

  let step = 'init';
  try {
    step = 'parseBody';
    const body = await request.json().catch(() => null);
    const name = body?.name?.trim();
    if (!name) return json({ error: 'name is required' }, 400);

    step = 'findUser';
    let dbUser = await db.users.findById(user.id);
    if (!dbUser) {
      // Auto-create profile if auth trigger missed (e.g. user signed up before trigger existed)
      const client = createAdminClient();
      await client.from('users').upsert({
        id: user.id,
        email: user.email ?? '',
        name: user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
      }, { onConflict: 'id' });
      dbUser = await db.users.findById(user.id);
      if (!dbUser) return json({ error: 'Failed to create user profile' }, 500);
    }

    step = 'countFree';
    if (dbUser.plan === 'free') {
      const freeCount = await db.projects.countFree(user.id);
      if (freeCount >= 1) {
        return json(
          { error: 'You already have a free site. Activate it to create another one.' },
          403
        );
      }
    }

    step = 'countByUser';
    const count = await db.projects.countByUser(user.id);
    if (count >= dbUser.projects_limit) {
      return json(
        { error: 'Project limit reached. Upgrade your plan to create more projects.' },
        403
      );
    }

    step = 'slugExists';
    let slug = generateSlug(name);
    let attempt = 0;
    while (await db.projects.slugExists(slug, user.id)) {
      attempt++;
      slug = `${generateSlug(name)}-${attempt}`;
    }

    step = 'insertProject';
    const supabase = createAdminClient();

    // Owner-equivalent users (plan=owner OR extra_edits>=999999) get unlimited
    // AI editor iterations on every project they create.
    const isOwnerEquiv = dbUser.plan === 'owner' || (dbUser.extra_edits ?? 0) >= 999999;
    const projectInsert: Record<string, unknown> = { user_id: user.id, name, slug };
    if (isOwnerEquiv) projectInsert.iterations_quota = 999999;

    const { data: project, error: projErr } = await supabase
      .from('projects')
      .insert(projectInsert)
      .select('*')
      .single();

    if (projErr) throw projErr;

    step = 'insertBrief';
    const { error: briefErr } = await supabase.from('briefs').insert({ project_id: project.id });
    if (briefErr) {
      await supabase.from('projects').delete().eq('id', project.id);
      throw briefErr;
    }

    step = 'insertConversation';
    const { data: conversation, error: convErr } = await supabase
      .from('conversations')
      .insert({ project_id: project.id })
      .select('id')
      .single();

    if (convErr) {
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
    console.error('[POST /api/projects]', typeof step !== 'undefined' ? `step=${step}` : '', e);
    return json({ error: 'Internal server error' }, 500);
  }
};
