// ─── Finalize direct-upload ─────────────────────────────────────────────────
// After the client uploads a file directly to Supabase Storage (via the
// sign-upload signed URL), this endpoint registers the asset row.
// For zip archives it triggers extract-zip in-process.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';
import type { AssetType } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';

const BUCKET = 'assets';
const VALID_ASSET_TYPES: AssetType[] = ['logo', 'hero', 'section', 'og', 'favicon', 'font', 'menu', 'document', 'other', 'video'] as any;

export const POST: APIRoute = async ({ params, locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON body' }, 400); }

  const {
    storagePath,
    publicUrl,
    contentType,
    filename,
    sizeBytes,
    kind = 'image',
    assetType = 'section',
    sectionId,
  } = body as {
    storagePath: string;
    publicUrl:   string;
    contentType: string;
    filename:    string;
    sizeBytes?:  number;
    kind?:       'image' | 'video' | 'zip';
    assetType?:  string;
    sectionId?:  string;
  };

  if (!storagePath || !publicUrl || !contentType || !filename) {
    return json({ error: 'storagePath, publicUrl, contentType, filename required' }, 400);
  }

  // Verify storagePath belongs to this project (prevents cross-project hijack)
  if (!storagePath.startsWith(`${params.projectId}/`)) {
    return json({ error: 'Invalid storagePath' }, 400);
  }

  const supabase = createAdminClient();

  // Verify the file actually exists in Storage before registering it.
  // (HEAD via getPublicUrl + fetch — cheap and authoritative.)
  try {
    const head = await fetch(publicUrl, { method: 'HEAD' });
    if (!head.ok) return json({ error: `File not found in storage (${head.status})` }, 404);
  } catch (e) {
    console.warn('[finalize] HEAD check failed (continuing):', e);
  }

  // ── ZIP: extract and create one asset per image inside ──────────────────
  if (kind === 'zip') {
    try {
      const { extractZipAssets } = await import('../../../../lib/zip-extract');
      const result = await extractZipAssets({
        projectId:   params.projectId!,
        zipPath:     storagePath,
        zipPublicUrl: publicUrl,
        defaultType: (assetType as AssetType) || 'section',
      });

      // Best-effort: delete the original zip blob to save storage
      try { await supabase.storage.from(BUCKET).remove([storagePath]); } catch { /* ignore */ }

      return json({
        ok:           true,
        kind:         'zip',
        extracted:    result.extracted,
        skipped:      result.skipped,
        totalBytes:   result.totalBytes,
        assets:       result.assets,
        errors:       result.errors,
      }, 201);
    } catch (e: any) {
      console.error('[finalize] ZIP extract error:', e?.message || e);
      return json({ error: `Zip extraction failed: ${e?.message || 'unknown'}` }, 500);
    }
  }

  // ── Image / Video: register single asset ────────────────────────────────
  const t = (assetType as AssetType);
  if (!VALID_ASSET_TYPES.includes(t)) return json({ error: `Invalid assetType: ${assetType}` }, 400);

  const metadata: Record<string, any> = {};
  if (sectionId) metadata.sectionId = sectionId;
  if (kind === 'video') metadata.kind = 'video';

  let asset;
  try {
    asset = await db.assets.create({
      project_id:  params.projectId!,
      type:        t,
      filename:    filename,
      storage_path: storagePath,
      public_url:  publicUrl,
      mime_type:   contentType,
      size_bytes:  sizeBytes ?? 0,
      metadata:    Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  } catch (e: any) {
    // Roll back the storage upload on DB failure
    try { await supabase.storage.from(BUCKET).remove([storagePath]); } catch { /* ignore */ }
    console.error('[finalize] DB save error:', e?.message || e);
    return json({ error: `DB save failed: ${e?.message || 'unknown'}` }, 500);
  }

  // Enrich brief based on asset type
  try {
    if (t === 'logo')   await db.briefs.merge(params.projectId!, { 'branding.logo': publicUrl });
    if (t === 'hero')   await db.briefs.merge(params.projectId!, { 'media.heroImage': publicUrl });
    if (t === 'og')     await db.briefs.merge(params.projectId!, { 'media.ogImage': publicUrl });
    if (t === 'favicon') await db.briefs.merge(params.projectId!, { 'media.favicon': publicUrl });
    if (t === 'video')  await db.briefs.merge(params.projectId!, { 'media.videoUrl': publicUrl });
    if (t === 'menu')   await db.briefs.merge(params.projectId!, { 'media.menuImage': publicUrl });
    if (t === 'section' && sectionId) {
      const brief = await db.briefs.findByProjectId(params.projectId!);
      const sectionImages: Record<string, string> = { ...(brief?.data?.media?.sectionImages ?? {}) };
      sectionImages[sectionId] = publicUrl;
      await db.briefs.merge(params.projectId!, { 'media.sectionImages': sectionImages });
    }
  } catch (e) {
    console.warn('[finalize] Brief enrichment failed (non-fatal):', e);
  }

  return json({ ok: true, kind, asset }, 201);
};
