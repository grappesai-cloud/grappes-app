import type { APIRoute } from 'astro';
import { del as blobDel } from '@lib/r2-blob';
import { db } from '../../../../../lib/db';

import { json } from '../../../../../lib/api-utils';

export const DELETE: APIRoute = async ({ params, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const asset = await db.assets.findById(params.assetId!);
  if (!asset || asset.project_id !== params.projectId) return json({ error: 'Asset not found' }, 404);

  // Remove primary file + responsive variants from Vercel Blob.
  const urlsToDelete: string[] = [];
  if (asset.public_url) urlsToDelete.push(asset.public_url);
  const variantUrls = (asset.metadata as any)?.variants as Record<string, string> | undefined;
  if (variantUrls) urlsToDelete.push(...Object.values(variantUrls));

  if (urlsToDelete.length > 0) {
    try {
      await blobDel(urlsToDelete);
    } catch (e) {
      console.error('[DELETE asset] Blob delete error (continuing):', e);
      // Orphaned blobs are preferable to orphaned DB rows.
    }
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
