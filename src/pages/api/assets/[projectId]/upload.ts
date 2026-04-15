import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';
import type { AssetType } from '../../../../lib/db';
import sharp from 'sharp';

import { json } from '../../../../lib/api-utils';
import { checkRateLimit } from '../../../../lib/rate-limit';
const BUCKET = 'assets';

const TYPE_LIMITS: Record<AssetType, number> = {
  logo: 2 * 1024 * 1024,
  favicon: 512 * 1024,
  og: 2 * 1024 * 1024,
  hero: 10 * 1024 * 1024,
  section: 5 * 1024 * 1024,
  font: 2 * 1024 * 1024,
  menu: 10 * 1024 * 1024,
  video: 50 * 1024 * 1024,
  other: 10 * 1024 * 1024,
};

const ALLOWED_MIME: Record<AssetType, string[]> = {
  logo: ['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg'],
  favicon: ['image/png', 'image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon'],
  og: ['image/png', 'image/jpeg', 'image/webp'],
  hero: ['image/png', 'image/jpeg', 'image/webp'],
  section: ['image/png', 'image/jpeg', 'image/webp'],
  menu: ['image/png', 'image/jpeg', 'image/webp'],
  font: ['font/woff', 'font/woff2', 'font/ttf'],
  video: ['video/mp4', 'video/webm'],
  other: ['image/png', 'image/jpeg', 'image/webp'],
};

// These formats are not converted — they're stored as-is (SVG is sanitized first)
const NO_CONVERT = new Set(['image/svg+xml', 'image/x-icon', 'image/vnd.microsoft.icon']);

/** Strip dangerous elements/attributes from SVG to prevent stored XSS */
function sanitizeSvg(svgBuffer: Buffer): Buffer {
  let svg = svgBuffer.toString('utf-8');
  // Remove script tags and their content
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  // Remove event handler attributes (onclick, onload, onerror, etc.)
  svg = svg.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  // Remove javascript: and data: URIs in href/xlink:href/src (case-insensitive, whitespace-tolerant)
  svg = svg.replace(/(href|src)\s*=\s*["']?\s*(?:javascript|data\s*:(?!image\/))[^"'>\s]*/gi, '$1=""');
  // Remove foreignObject (can embed arbitrary HTML)
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  // Remove iframe, embed, object elements
  svg = svg.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  svg = svg.replace(/<embed[\s\S]*?>/gi, '');
  svg = svg.replace(/<object[\s\S]*?<\/object>/gi, '');
  // Remove set/animate elements that can trigger scripts via attributeName="href"
  svg = svg.replace(/<set[\s\S]*?\/?\s*>/gi, '');
  svg = svg.replace(/<animate[\s\S]*?\/?\s*>/gi, '');
  // Remove use elements pointing to external resources
  svg = svg.replace(/<use[^>]*href\s*=\s*["']https?:\/\/[^"']*["'][^>]*\/?\s*>/gi, '');
  return Buffer.from(svg, 'utf-8');
}

const VALID_TYPES: AssetType[] = ['logo', 'hero', 'section', 'og', 'favicon', 'font', 'menu', 'other'];

/** Detect MIME type from file header magic bytes */
function detectMimeFromHeader(h: Uint8Array): string | null {
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4E && h[3] === 0x47) return 'image/png';
  if (h[0] === 0xFF && h[1] === 0xD8 && h[2] === 0xFF) return 'image/jpeg';
  if (h[0] === 0x52 && h[1] === 0x49 && h[2] === 0x46 && h[3] === 0x46 &&
      h[8] === 0x57 && h[9] === 0x45 && h[10] === 0x42 && h[11] === 0x50) return 'image/webp';
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return 'image/gif';
  if (h[0] === 0x00 && h[1] === 0x00 && h[2] === 0x01 && h[3] === 0x00) return 'image/x-icon';
  // SVG starts with < (after optional BOM/whitespace)
  const str = String.fromCharCode(...h.slice(0, 5));
  if (str.trimStart().startsWith('<')) return null; // could be SVG or XML — skip (validated by sanitizeSvg)
  return null; // unknown — let it through
}

/** Check if detected MIME is compatible with claimed MIME (e.g. ico variants) */
function isCompatibleMime(claimed: string, detected: string): boolean {
  const icoTypes = ['image/x-icon', 'image/vnd.microsoft.icon'];
  if (icoTypes.includes(claimed) && icoTypes.includes(detected)) return true;
  return false;
}


function mimeToExt(mime: string): string {
  const map: Record<string, string> = {
    'image/webp': 'webp',
    'image/svg+xml': 'svg',
    'image/x-icon': 'ico',
    'image/vnd.microsoft.icon': 'ico',
    'font/woff': 'woff',
    'font/woff2': 'woff2',
    'font/ttf': 'ttf',
  };
  return map[mime] ?? 'webp';
}

/**
 * Convert raster image buffer to WebP.
 * Returns { buffer, mimeType } — either converted WebP or original if skipped.
 */
async function toWebP(
  buffer: ArrayBuffer,
  mime: string,
  type: AssetType
): Promise<{ buffer: Buffer; mimeType: string }> {
  // Skip conversion for vector/icon formats (sanitize SVG to prevent XSS)
  if (NO_CONVERT.has(mime)) {
    const raw = Buffer.from(buffer);
    return { buffer: mime === 'image/svg+xml' ? sanitizeSvg(raw) : raw, mimeType: mime };
  }

  // Quality settings per asset type
  const quality: Record<string, number> = {
    logo: 90,
    og: 85,
    favicon: 90,
    hero: 82,
    section: 80,
    other: 80,
    font: 100,
  };

  const webpBuffer = await sharp(Buffer.from(buffer))
    .webp({ quality: quality[type] ?? 82 })
    .toBuffer();

  return { buffer: webpBuffer, mimeType: 'image/webp' };
}

const RESPONSIVE_WIDTHS = [640, 1280, 1920]; // mobile, tablet, desktop
const RESIZE_TYPES = new Set<AssetType>(['hero', 'section', 'og']);

async function generateResponsiveVariants(
  buffer: Buffer,
  mime: string,
  type: AssetType,
  quality: number
): Promise<Array<{ width: number; buffer: Buffer; suffix: string }>> {
  // Skip non-raster and non-resizable types
  if (NO_CONVERT.has(mime) || !RESIZE_TYPES.has(type)) return [];

  const meta = await sharp(buffer).metadata();
  if (!meta.width) return [];

  const variants: Array<{ width: number; buffer: Buffer; suffix: string }> = [];

  for (const w of RESPONSIVE_WIDTHS) {
    // Only downscale, never upscale
    if (w >= meta.width) continue;

    const resized = await sharp(buffer)
      .resize(w, null, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality })
      .toBuffer();

    variants.push({ width: w, buffer: resized, suffix: `-${w}w` });
  }

  return variants;
}

export const POST: APIRoute = async (ctx) => {
  try {
    return await handleUpload(ctx);
  } catch (e: any) {
    console.error('[upload] UNEXPECTED:', e?.stack || e?.message || e);
    return json({ error: `Upload failed: ${e?.message || 'unknown'}` }, 500);
  }
};

async function handleUpload({ params, locals, request }: Parameters<APIRoute>[0]): Promise<Response> {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  // 50 uploads/hour per user
  if (!checkRateLimit(`upload:${user.id}`, 50, 3_600_000)) {
    return json({ error: 'Too many uploads. Please wait.' }, 429);
  }

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return json({ error: 'Invalid multipart form data' }, 400);
  }

  const file = formData.get('file') as File | null;
  const typeRaw = formData.get('type') as string | null;
  const sectionId = formData.get('sectionId') as string | null;
  const altText = formData.get('altText') as string | null;
  const note = formData.get('note') as string | null;
  const orderRaw = formData.get('order') as string | null;

  if (!file || !typeRaw) return json({ error: 'Missing file or type' }, 400);

  const type = typeRaw as AssetType;
  if (!VALID_TYPES.includes(type)) return json({ error: `Invalid type: ${type}` }, 400);

  const maxSize = TYPE_LIMITS[type];
  if (file.size > maxSize) {
    return json({ error: `File too large. Max ${Math.round(maxSize / 1024 / 1024)}MB for ${type}` }, 413);
  }

  const allowed = ALLOWED_MIME[type];
  if (allowed.length > 0 && !allowed.includes(file.type)) {
    return json({ error: `Invalid file type "${file.type}" for asset type "${type}"` }, 415);
  }

  // Read original buffer
  const originalBuffer = await file.arrayBuffer();

  // Magic byte validation — verify file content matches claimed MIME type
  const header = new Uint8Array(originalBuffer.slice(0, 12));
  const detectedMime = detectMimeFromHeader(header);
  if (detectedMime && file.type !== detectedMime && !isCompatibleMime(file.type, detectedMime)) {
    return json({ error: `File content does not match declared type "${file.type}"` }, 415);
  }

  // Convert to WebP (or keep original for SVG/ICO)
  let convertedBuffer: Buffer;
  let finalMime: string;
  try {
    const result = await toWebP(originalBuffer, file.type, type);
    convertedBuffer = result.buffer;
    finalMime = result.mimeType;
  } catch (e) {
    console.error('[upload] Conversion error:', e);
    return json({ error: 'Image conversion failed' }, 500);
  }

  // Build storage path with final extension
  const uuid = crypto.randomUUID();
  const extension = mimeToExt(finalMime);
  const storagePath = `${params.projectId}/${type}/${uuid}.${extension}`;

  // Upload converted file to Supabase Storage (with retry)
  const supabase = createAdminClient();
  let uploadError: any = null;
  for (let attempt = 0; attempt < 2; attempt++) {
    const { error } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, convertedBuffer, { contentType: finalMime, upsert: false });
    uploadError = error;
    if (!error) break;
    console.warn(`[upload] Storage attempt ${attempt + 1} failed:`, error.message);
    if (attempt === 0) await new Promise(r => setTimeout(r, 500));
  }

  if (uploadError) {
    console.error('[upload] Storage error after retries:', uploadError);
    return json({ error: `Storage upload failed: ${uploadError.message}` }, 500);
  }

  const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
  const publicUrl = urlData.publicUrl;

  // Generate and upload responsive variants for hero/section images
  const variantUrls: Record<string, string> = {};
  const variantPaths: string[] = []; // stored for cleanup on delete
  try {
    const qualityMap: Partial<Record<AssetType, number>> = { hero: 82, section: 80, og: 85 };
    const quality = qualityMap[type] ?? 80;
    const variants = await generateResponsiveVariants(convertedBuffer, finalMime, type, quality);

    for (const v of variants) {
      const variantPath = `${params.projectId}/${type}/${uuid}${v.suffix}.webp`;
      const { error: vErr } = await supabase.storage
        .from(BUCKET)
        .upload(variantPath, v.buffer, { contentType: 'image/webp', upsert: false });

      if (!vErr) {
        const { data: vUrl } = supabase.storage.from(BUCKET).getPublicUrl(variantPath);
        variantUrls[`${v.width}w`] = vUrl.publicUrl;
        variantPaths.push(variantPath);
      }
    }
  } catch (e) {
    console.warn('[upload] Responsive variant generation failed (non-fatal):', e);
  }

  // Build metadata
  const metadata: Record<string, any> = {};
  if (sectionId) metadata.sectionId = sectionId;
  if (altText) metadata.altText = altText;
  if (note) metadata.note = note;
  if (orderRaw !== null) metadata.order = parseInt(orderRaw, 10);
  if (Object.keys(variantUrls).length > 0) {
    metadata.variants = variantUrls;
    metadata.variantPaths = variantPaths; // stored for cleanup on delete
  }

  // Determine stored filename (reflect WebP conversion)
  const wasConverted = finalMime === 'image/webp' && file.type !== 'image/webp';
  const storedFilename = wasConverted
    ? file.name.replace(/\.[^.]+$/, '.webp')
    : file.name;

  let asset;
  try {
    asset = await db.assets.create({
      project_id: params.projectId!,
      type,
      filename: storedFilename,
      storage_path: storagePath,
      public_url: publicUrl,
      mime_type: finalMime,
      size_bytes: convertedBuffer.length,
      metadata: Object.keys(metadata).length > 0 ? metadata : undefined,
    });
  } catch (e) {
    // Rollback storage upload
    await supabase.storage.from(BUCKET).remove([storagePath]);
    console.error('[upload] DB error:', e);
    return json({ error: 'Failed to save asset record' }, 500);
  }

  // Enrich brief (non-fatal)
  await enrichBrief(params.projectId!, type, publicUrl, metadata, variantUrls);

  return json({ asset, converted: wasConverted, variants: variantUrls }, 201);
}

async function enrichBrief(
  projectId: string,
  type: AssetType,
  publicUrl: string,
  metadata: Record<string, any>,
  variantUrls: Record<string, string>
) {
  try {
    if (type === 'logo') {
      await db.briefs.merge(projectId, { 'branding.logo': publicUrl });
    } else if (type === 'hero') {
      const mergeData: Record<string, any> = { 'media.heroImage': publicUrl };
      if (Object.keys(variantUrls).length > 0) mergeData['media.heroVariants'] = variantUrls;
      await db.briefs.merge(projectId, mergeData);
    } else if (type === 'og') {
      await db.briefs.merge(projectId, { 'media.ogImage': publicUrl });
    } else if (type === 'favicon') {
      await db.briefs.merge(projectId, { 'media.favicon': publicUrl });
    } else if (type === 'section' && metadata.sectionId) {
      const brief = await db.briefs.findByProjectId(projectId);
      const sectionImages: Record<string, string> = { ...(brief?.data?.media?.sectionImages ?? {}) };
      sectionImages[metadata.sectionId] = publicUrl;
      const mergeData: Record<string, any> = { 'media.sectionImages': sectionImages };
      if (Object.keys(variantUrls).length > 0) {
        const sectionVariants: Record<string, Record<string, string>> = {
          ...(brief?.data?.media?.sectionVariants ?? {}),
        };
        sectionVariants[metadata.sectionId] = variantUrls;
        mergeData['media.sectionVariants'] = sectionVariants;
      }
      await db.briefs.merge(projectId, mergeData);
    } else if (type === 'menu') {
      await db.briefs.merge(projectId, { 'media.menuImage': publicUrl });
    }
  } catch (e) {
    console.warn('[upload] Brief enrichment failed (non-fatal):', e);
  }
}
