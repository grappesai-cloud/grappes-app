import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';

// Supported locales
const SUPPORTED = new Set(['ro', 'en', 'fr', 'de', 'es', 'it', 'pt', 'nl', 'pl', 'hu']);

export const POST: APIRoute = async ({ request, params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const projectId = params.projectId;
  if (!projectId) return json({ error: 'Missing projectId' }, 400);

  // Verify ownership
  const project = await db.projects.findById(projectId);
  if (!project || project.user_id !== user.id) {
    return json({ error: 'Not found' }, 404);
  }

  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const briefLocale = (body?.briefLocale ?? '').toString().toLowerCase().slice(0, 5);
  const siteLocale  = (body?.siteLocale  ?? '').toString().toLowerCase().slice(0, 5);

  if (!SUPPORTED.has(briefLocale) || !SUPPORTED.has(siteLocale)) {
    return json({ error: 'Unsupported locale' }, 400);
  }

  try {
    // Merge into briefs.data.business — briefLocale is chat-only,
    // locale (==siteLocale) is the existing slot the generator already reads.
    await db.briefs.merge(projectId, {
      'business.briefLocale': briefLocale,
      'business.locale':      siteLocale,
    });
    return json({ ok: true, briefLocale, siteLocale });
  } catch (e: any) {
    console.error('[language POST]', e);
    return json({ error: 'Failed to save language' }, 500);
  }
};
