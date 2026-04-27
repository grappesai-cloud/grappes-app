// ─── ZIP extraction → Supabase assets ───────────────────────────────────────
// Streams a zip from Supabase Storage, extracts each image entry, runs it
// through the standard sharp → WebP pipeline, then uploads the result back
// to Storage and inserts a row in `assets`.
//
// Auto-tagging by subfolder convention:
//   /logo/* → AssetType "logo"
//   /hero/* → AssetType "hero"
//   /og/*   → AssetType "og"
//   /favicon/* → AssetType "favicon"
//   /sections/<id>/* or /section/<id>/* → AssetType "section" with sectionId
//   /menu/* → AssetType "menu"
//   anything else → AssetType "section" (or whatever defaultType says)

import yauzl from 'yauzl';
import sharp from 'sharp';
import { Readable } from 'node:stream';
import { db } from './db';
import { createAdminClient } from './supabase';
import type { AssetType } from './db';

const BUCKET = 'assets';
const MAX_ENTRIES   = 100;                  // hard cap on files extracted from one zip
const MAX_PER_FILE  = 30 * 1024 * 1024;     // 30MB per individual file inside zip
const MAX_TOTAL     = 250 * 1024 * 1024;    // 250MB total uncompressed

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'svg']);

interface ExtractResult {
  extracted:  number;
  skipped:    number;
  totalBytes: number;
  assets:     Array<{ id: string; type: AssetType; public_url: string; filename: string }>;
  errors:     string[];
}

interface ExtractOpts {
  projectId:    string;
  zipPath:      string;             // storage path of the uploaded zip
  zipPublicUrl: string;
  defaultType:  AssetType;
}

function classifyEntry(entryPath: string, defaultType: AssetType): { type: AssetType; sectionId?: string } {
  const lower = entryPath.toLowerCase();
  const parts = lower.split('/').filter(Boolean);

  // Skip __MACOSX, .DS_Store, and dot-prefixed directories
  if (parts.some(p => p === '__macosx' || p === '.ds_store' || p.startsWith('._'))) {
    return { type: defaultType };
  }

  // /logo/, /logos/
  if (parts.some(p => p === 'logo' || p === 'logos')) return { type: 'logo' };
  if (parts.some(p => p === 'hero' || p === 'heroes' || p === 'header')) return { type: 'hero' };
  if (parts.some(p => p === 'og' || p === 'social' || p === 'share')) return { type: 'og' };
  if (parts.some(p => p === 'favicon' || p === 'icon' || p === 'icons')) return { type: 'favicon' };
  if (parts.some(p => p === 'menu')) return { type: 'menu' };
  if (parts.some(p => p === 'video' || p === 'videos')) return { type: 'video' as AssetType };

  // /sections/<id>/* or /section/<id>/*
  const sectionIdx = parts.findIndex(p => p === 'section' || p === 'sections');
  if (sectionIdx >= 0 && parts.length > sectionIdx + 2) {
    return { type: 'section', sectionId: parts[sectionIdx + 1] };
  }

  return { type: defaultType };
}

function extToMime(ext: string): string {
  const m: Record<string, string> = {
    png:  'image/png',
    jpg:  'image/jpeg',
    jpeg: 'image/jpeg',
    webp: 'image/webp',
    gif:  'image/gif',
    svg:  'image/svg+xml',
  };
  return m[ext] || 'application/octet-stream';
}

function streamToBuffer(stream: Readable, maxBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let total = 0;
    stream.on('data', (c: Buffer) => {
      total += c.length;
      if (total > maxBytes) {
        stream.destroy(new Error(`File exceeds ${maxBytes} bytes`));
        return;
      }
      chunks.push(c);
    });
    stream.on('end', () => resolve(Buffer.concat(chunks)));
    stream.on('error', reject);
  });
}

export async function extractZipAssets(opts: ExtractOpts): Promise<ExtractResult> {
  const { projectId, zipPath, defaultType } = opts;
  const supabase = createAdminClient();

  // Download the zip to a buffer (we already validated max size at sign-upload).
  const { data: blob, error: dlErr } = await supabase.storage.from(BUCKET).download(zipPath);
  if (dlErr || !blob) throw new Error(`Failed to download zip: ${dlErr?.message ?? 'no data'}`);
  const zipBuffer = Buffer.from(await blob.arrayBuffer());

  const result: ExtractResult = {
    extracted: 0,
    skipped:   0,
    totalBytes: 0,
    assets:    [],
    errors:    [],
  };

  await new Promise<void>((resolve, reject) => {
    yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, async (err, zipfile) => {
      if (err || !zipfile) return reject(err ?? new Error('Failed to open zip'));

      let entriesProcessed = 0;
      let totalBytes = 0;

      zipfile.on('error', reject);
      zipfile.on('end', () => resolve());

      zipfile.on('entry', async (entry) => {
        try {
          // Directory entries end with '/'
          if (/\/$/.test(entry.fileName)) { zipfile.readEntry(); return; }

          if (entriesProcessed >= MAX_ENTRIES) {
            result.skipped++;
            zipfile.readEntry();
            return;
          }

          const ext = entry.fileName.split('.').pop()?.toLowerCase() ?? '';
          if (!IMAGE_EXTS.has(ext)) {
            result.skipped++;
            zipfile.readEntry();
            return;
          }

          if (entry.uncompressedSize > MAX_PER_FILE) {
            result.errors.push(`${entry.fileName}: file too large (${Math.round(entry.uncompressedSize / 1024 / 1024)}MB)`);
            result.skipped++;
            zipfile.readEntry();
            return;
          }

          if (totalBytes + entry.uncompressedSize > MAX_TOTAL) {
            result.errors.push(`${entry.fileName}: total uncompressed size cap (${MAX_TOTAL / 1024 / 1024}MB) reached`);
            result.skipped++;
            zipfile.readEntry();
            return;
          }

          const classification = classifyEntry(entry.fileName, defaultType);

          // Open read stream, collect buffer (with size guard)
          const readStream = await new Promise<Readable>((res, rej) => {
            zipfile.openReadStream(entry, (e, s) => e ? rej(e) : res(s as Readable));
          });
          const fileBuf = await streamToBuffer(readStream, MAX_PER_FILE);
          totalBytes += fileBuf.length;

          // Convert to WebP except SVG (sanitize) and animated GIFs
          let finalBuffer: Buffer = fileBuf;
          let finalMime = extToMime(ext);
          let finalExt  = ext;

          if (ext === 'svg') {
            finalBuffer = sanitizeSvgBuffer(fileBuf);
            finalMime = 'image/svg+xml';
          } else {
            try {
              finalBuffer = await sharp(fileBuf).webp({ quality: 82 }).toBuffer();
              finalMime = 'image/webp';
              finalExt  = 'webp';
            } catch (sharpErr) {
              // sharp failed → keep original
              console.warn(`[zip-extract] sharp failed for ${entry.fileName}, keeping original`);
            }
          }

          // Upload to Supabase Storage
          const baseName = entry.fileName.split('/').pop()?.replace(/\.[^.]+$/, '') ?? `image-${entriesProcessed}`;
          const safeName = baseName.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 60) || `image-${entriesProcessed}`;
          const uuid = crypto.randomUUID();
          const outPath = `${projectId}/${classification.type}/${uuid}-${safeName}.${finalExt}`;

          const { error: upErr } = await supabase.storage
            .from(BUCKET)
            .upload(outPath, finalBuffer, { contentType: finalMime, upsert: false });

          if (upErr) {
            result.errors.push(`${entry.fileName}: upload failed (${upErr.message})`);
            result.skipped++;
            zipfile.readEntry();
            return;
          }

          const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(outPath);
          const publicUrl = urlData.publicUrl;

          // Build metadata + DB row
          const metadata: Record<string, any> = { fromZip: true, originalPath: entry.fileName };
          if (classification.sectionId) metadata.sectionId = classification.sectionId;

          let asset;
          try {
            asset = await db.assets.create({
              project_id:   projectId,
              type:         classification.type,
              filename:     `${safeName}.${finalExt}`,
              storage_path: outPath,
              public_url:   publicUrl,
              mime_type:    finalMime,
              size_bytes:   finalBuffer.length,
              metadata,
            });
          } catch (dbErr: any) {
            result.errors.push(`${entry.fileName}: DB save failed (${dbErr?.message ?? 'unknown'})`);
            try { await supabase.storage.from(BUCKET).remove([outPath]); } catch { /* ignore */ }
            result.skipped++;
            zipfile.readEntry();
            return;
          }

          result.extracted++;
          entriesProcessed++;
          result.assets.push({
            id:         asset.id,
            type:       classification.type,
            public_url: publicUrl,
            filename:   `${safeName}.${finalExt}`,
          });

          // Brief enrichment for special types
          try {
            if (classification.type === 'logo')    await db.briefs.merge(projectId, { 'branding.logo': publicUrl });
            if (classification.type === 'hero')    await db.briefs.merge(projectId, { 'media.heroImage': publicUrl });
            if (classification.type === 'og')      await db.briefs.merge(projectId, { 'media.ogImage': publicUrl });
            if (classification.type === 'favicon') await db.briefs.merge(projectId, { 'media.favicon': publicUrl });
          } catch { /* non-fatal */ }

          zipfile.readEntry();
        } catch (e: any) {
          result.errors.push(`${entry.fileName}: ${e?.message ?? 'extract error'}`);
          result.skipped++;
          zipfile.readEntry();
        }
      });

      zipfile.readEntry();
      result.totalBytes = totalBytes;
    });
  });

  result.totalBytes = Math.max(result.totalBytes, 0);
  return result;
}

function sanitizeSvgBuffer(buf: Buffer): Buffer {
  let svg = buf.toString('utf-8');
  svg = svg.replace(/<script[\s\S]*?<\/script>/gi, '');
  svg = svg.replace(/\s+on\w+\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+)/gi, '');
  svg = svg.replace(/(href|src)\s*=\s*["']?\s*(?:javascript|data\s*:(?!image\/))[^"'>\s]*/gi, '$1=""');
  svg = svg.replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '');
  svg = svg.replace(/<iframe[\s\S]*?<\/iframe>/gi, '');
  svg = svg.replace(/<embed[\s\S]*?>/gi, '');
  svg = svg.replace(/<object[\s\S]*?<\/object>/gi, '');
  return Buffer.from(svg, 'utf-8');
}
