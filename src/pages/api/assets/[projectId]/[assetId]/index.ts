import type { APIRoute } from 'astro';
import { db } from '../../../../../lib/db';
import { createAdminClient } from '../../../../../lib/supabase';

import { json } from '../../../../../lib/api-utils';
const BUCKET = 'assets';


export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const asset = await db.assets.findById(params.assetId!);
  if (!asset || asset.project_id !== params.projectId) return json({ error: 'Asset not found' }, 404);

  // Remove primary file + responsive variants from storage
  const supabase = createAdminClient();
  const pathsToDelete = [asset.storage_path];
  const variantPaths = (asset.metadata as any)?.variantPaths as string[] | undefined;
  if (variantPaths?.length) {
    pathsToDelete.push(...variantPaths);
  }

  const { error: storageErr } = await supabase.storage
    .from(BUCKET)
    .remove(pathsToDelete);

  if (storageErr) {
    console.error('[DELETE asset] Storage error:', storageErr);
    // Continue to delete DB record — orphaned files are preferable to orphaned DB records
  }

  await db.assets.delete(asset.id);

  return json({ ok: true });
};

export const PATCH: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const asset = await db.assets.findById(params.assetId!);
  if (!asset || asset.project_id !== params.projectId) return json({ error: 'Asset not found' }, 404);

  let body: Record<string, any>;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, 400);
  }

  const VALID_TYPES = ['logo', 'hero', 'section', 'og', 'favicon', 'font', 'menu', 'video', 'other'];
  const updates: Record<string, any> = {};
  if (body.metadata !== undefined) updates.metadata = { ...(asset.metadata ?? {}), ...body.metadata };
  if (body.type !== undefined) {
    if (!VALID_TYPES.includes(body.type)) return json({ error: `Invalid type: ${body.type}` }, 400);
    updates.type = body.type;
  }

  if (Object.keys(updates).length === 0) return json({ asset });

  const updated = await db.assets.update(asset.id, updates);
  return json({ asset: updated });
};
