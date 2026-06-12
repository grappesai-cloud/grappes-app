// ─── Finalize direct-upload ─────────────────────────────────────────────────
// After the client uploads a file directly to Vercel Blob (via the
// sign-upload handleUpload flow), this endpoint registers the asset row.
// For zip archives it triggers extract-zip in-process.

import type { APIRoute } from 'astro';
import { put as blobPut, del as blobDel } from '@vercel/blob';
import sharp from 'sharp';
import { db } from '../../../../lib/db';
import type { AssetType } from '../../../../lib/db';
import { json } from '../../../../lib/api-utils';
import { isHeic, heicToJpeg } from '../../../../lib/heic';

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

  // Verify storagePath belongs to this project (prevents cross-project hijack).
  // sign-upload stamps blobs at: assets/<projectId>/<folder>/<uuid>.<ext>
  const projectPathPrefix = `assets/${params.projectId}/`;
  if (!storagePath.startsWith(projectPathPrefix) && !storagePath.startsWith(`${params.projectId}/`)) {
    return json({ error: 'Invalid storagePath' }, 400);
  }

  // Verify the file actually exists in Blob before registering it.
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
        projectId:    params.projectId!,
        zipPath:      storagePath,
        zipPublicUrl: publicUrl,
        defaultType:  (assetType as AssetType) || 'section',
      });

      // Best-effort: delete the original zip blob to save storage
      try { await blobDel(publicUrl); } catch { /* ignore */ }

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

  // A direct-uploaded HEIC/HEIF lands raw (this path doesn't convert), and most
  // browsers can't render it — convert to WebP, re-store, and drop the raw.
  let curPath = storagePath, curUrl = publicUrl, curMime = contentType, curName = filename;
  if (kind === 'image' && (isHeic(contentType, filename) || /\.(heic|heif)$/i.test(storagePath))) {
    try {
      const res = await fetch(publicUrl);
      if (!res.ok) throw new Error(`fetch raw failed (${res.status})`);
      const jpeg = await heicToJpeg(Buffer.from(await res.arrayBuffer()));
      const webp = await sharp(jpeg).webp({ quality: 82 }).toBuffer();
      const webpPath = storagePath.replace(/\.(heic|heif)$/i, '.webp');
      const blob = await blobPut(webpPath, webp, { access: 'public', contentType: 'image/webp', addRandomSuffix: false, allowOverwrite: true });
      try { await blobDel(publicUrl); } catch { /* ignore */ }
      curPath = webpPath; curUrl = blob.url; curMime = 'image/webp';
      curName = filename.replace(/\.(heic|heif)$/i, '.webp');
    } catch (e: any) {
      console.error('[finalize] HEIC convert failed:', e?.message || e);
      try { await blobDel(publicUrl); } catch { /* ignore */ }
      return json({ error: 'Could not process this HEIC photo. Please try a JPEG or PNG.' }, 415);
    }
  }

  const metadata: Record<string, any> = {};
  if (sectionId) metadata.sectionId = sectionId;
  if (kind === 'video') metadata.kind = 'video';

  let asset;
  try {
    asset = await db.assets.create({
      project_id:   params.projectId!,
      type:         t,
      filename:     curName,
      storage_path: curPath,
      public_url:   curUrl,
      mime_type:    curMime,
      size_bytes:   sizeBytes ?? 0,
      metadata:     Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  } catch (e: any) {
    // Roll back the upload on DB failure
    try { await blobDel(curUrl); } catch { /* ignore */ }
    console.error('[finalize] DB save error:', e?.message || e);
    return json({ error: `DB save failed: ${e?.message || 'unknown'}` }, 500);
  }

  // Enrich brief based on asset type
  try {
    if (t === 'logo')   await db.briefs.merge(params.projectId!, { 'branding.logo': curUrl });
    if (t === 'hero')   await db.briefs.merge(params.projectId!, { 'media.heroImage': curUrl });
    if (t === 'og')     await db.briefs.merge(params.projectId!, { 'media.ogImage': curUrl });
    if (t === 'favicon') await db.briefs.merge(params.projectId!, { 'media.favicon': curUrl });
    if (t === 'video')  await db.briefs.merge(params.projectId!, { 'media.videoUrl': curUrl });
    if (t === 'menu')   await db.briefs.merge(params.projectId!, { 'media.menuImage': curUrl });
    if (t === 'section' && sectionId) {
      const brief = await db.briefs.findByProjectId(params.projectId!);
      const sectionImages: Record<string, string> = { ...(brief?.data?.media?.sectionImages ?? {}) };
      sectionImages[sectionId] = curUrl;
      await db.briefs.merge(params.projectId!, { 'media.sectionImages': sectionImages });
    }
  } catch (e) {
    console.warn('[finalize] Brief enrichment failed (non-fatal):', e);
  }

  return json({ ok: true, kind, asset }, 201);
};
