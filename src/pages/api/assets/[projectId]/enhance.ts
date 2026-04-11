// ─── Photo Enhancement Endpoint ─────────────────────────────────────────────
// Takes an uploaded photo, sends it to Gemini for professional enhancement,
// converts to WebP, replaces the original in storage.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';
import { enhancePhoto } from '../../../../lib/gemini';
import sharp from 'sharp';

import { checkRateLimit } from '../../../../lib/rate-limit';
import { json } from '../../../../lib/api-utils';
const BUCKET = 'assets';


export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`ai-enhance:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'Too many enhancement requests. Please wait.' }, 429);
  }

  try {
    const formData = await request.formData();
    const file = formData.get('file') as File | null;
    const type = (formData.get('type') as string) || 'section';
    const sectionId = (formData.get('sectionId') as string) || '';
    const sectionTitle = (formData.get('sectionTitle') as string) || '';

    if (!file) return json({ error: 'No file provided' }, 400);

    // Validate file
    const allowedMimes = ['image/png', 'image/jpeg', 'image/webp'];
    if (!allowedMimes.includes(file.type)) {
      return json({ error: 'Only PNG, JPEG, and WebP files are supported' }, 400);
    }
    if (file.size > 10 * 1024 * 1024) {
      return json({ error: 'File too large (max 10 MB)' }, 400);
    }

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const brief = await db.briefs.findByProjectId(params.projectId!);
    const businessContext = [
      brief?.data?.business?.name,
      brief?.data?.business?.industry,
      brief?.data?.business?.description,
    ].filter(Boolean).join('. ');

    // Read file buffer
    const arrayBuffer = await file.arrayBuffer();
    const inputBuffer = Buffer.from(arrayBuffer);

    // Enhance with Gemini
    console.log(`[enhance] Enhancing photo for project ${params.projectId} (${file.name}, ${file.size} bytes)`);
    const result = await enhancePhoto(inputBuffer, file.type, businessContext);

    // Convert to WebP
    const webpBuffer = await sharp(result.buffer)
      .webp({ quality: 85 })
      .toBuffer();

    // Upload enhanced version to Supabase Storage
    const supabase = createAdminClient();
    const filename = `enhanced-${type}-${Date.now()}.webp`;
    const storagePath = `${params.projectId}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, webpBuffer, {
        contentType: 'image/webp',
        upsert: false,
      });

    if (uploadError) {
      console.error('[enhance] Storage upload error:', uploadError);
      return json({ error: 'Failed to store enhanced image' }, 500);
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // Create asset record
    const asset = await db.assets.create({
      project_id: params.projectId!,
      type: type as any,
      filename,
      storage_path: storagePath,
      public_url: publicUrl,
      mime_type: 'image/webp',
      size_bytes: webpBuffer.length,
      metadata: {
        source: 'ai_enhanced',
        original_name: file.name,
        original_size: file.size,
        sectionId,
        sectionTitle,
      },
    });

    // Enrich brief
    if (type === 'hero') {
      await db.briefs.merge(params.projectId!, { 'media.heroImage': publicUrl });
    } else if (type === 'logo') {
      await db.briefs.merge(params.projectId!, { 'branding.logo': publicUrl });
    } else if (sectionId) {
      const currentBrief = await db.briefs.findByProjectId(params.projectId!);
      const sectionImages: Record<string, string> = { ...(currentBrief?.data?.media?.sectionImages ?? {}) };
      sectionImages[sectionId] = publicUrl;
      await db.briefs.merge(params.projectId!, { 'media.sectionImages': sectionImages });
    }

    console.log(`[enhance] Photo enhanced: ${publicUrl} (${inputBuffer.length} → ${webpBuffer.length} bytes)`);

    return json({
      asset,
      publicUrl,
      source: 'ai_enhanced',
      originalSize: file.size,
      enhancedSize: webpBuffer.length,
    }, 201);

  } catch (e: any) {
    console.error('[enhance] Error:', e);
    // Never expose raw SDK errors — they may contain API keys in URL parameters
    return json({ error: 'Failed to enhance image. Please try again.' }, 500);
  }
};
