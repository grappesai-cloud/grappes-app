// ─── AI Image Generation Endpoint ───────────────────────────────────────────
// Generates an image using Gemini based on brief context, converts to WebP,
// stores in Supabase Storage, creates asset record.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createAdminClient } from '../../../../lib/supabase';
import { generateImage, buildImagePrompt } from '../../../../lib/gemini';
import sharp from 'sharp';
import type { AssetType } from '../../../../lib/db';

import { checkRateLimit } from '../../../../lib/rate-limit';
import { json } from '../../../../lib/api-utils';
const BUCKET = 'assets';


export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`ai-generate:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'Too many AI generation requests. Please wait.' }, 429);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const type: AssetType = (body.type as AssetType) || 'section';
    const section: string = body.section || 'hero';
    const variant: string = body.variant || '';
    const sectionId: string = body.sectionId || '';

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const brief = await db.briefs.findByProjectId(params.projectId!);
    if (!brief?.data) return json({ error: 'Brief not found' }, 404);

    // Build prompt from brief context
    const prompt = buildImagePrompt(brief.data, section, variant);

    // Generate image with Gemini
    console.log(`[generate] Generating AI image for project ${params.projectId}, section: ${section}`);
    const result = await generateImage(prompt);

    // Convert to WebP
    const webpBuffer = await sharp(result.buffer)
      .webp({ quality: 85 })
      .toBuffer();

    // Upload to Supabase Storage
    const supabase = createAdminClient();
    const filename = `ai-${section}-${Date.now()}.webp`;
    const storagePath = `${params.projectId}/${filename}`;

    const { error: uploadError } = await supabase.storage
      .from(BUCKET)
      .upload(storagePath, webpBuffer, {
        contentType: 'image/webp',
        upsert: false,
      });

    if (uploadError) {
      console.error('[generate] Storage upload error:', uploadError);
      return json({ error: 'Failed to store generated image' }, 500);
    }

    const { data: urlData } = supabase.storage.from(BUCKET).getPublicUrl(storagePath);
    const publicUrl = urlData.publicUrl;

    // Create asset record
    const asset = await db.assets.create({
      project_id: params.projectId!,
      type,
      filename,
      storage_path: storagePath,
      public_url: publicUrl,
      mime_type: 'image/webp',
      size_bytes: webpBuffer.length,
      metadata: { source: 'ai_generated', prompt: prompt.slice(0, 500), section, sectionId },
    });

    // Enrich brief with the generated image
    if (type === 'hero' || section === 'hero') {
      await db.briefs.merge(params.projectId!, { 'media.heroImage': publicUrl });
    } else if (sectionId) {
      const currentBrief = await db.briefs.findByProjectId(params.projectId!);
      const sectionImages: Record<string, string> = { ...(currentBrief?.data?.media?.sectionImages ?? {}) };
      sectionImages[sectionId] = publicUrl;
      await db.briefs.merge(params.projectId!, { 'media.sectionImages': sectionImages });
    }

    console.log(`[generate] AI image generated: ${publicUrl} (${webpBuffer.length} bytes)`);

    return json({ asset, publicUrl, source: 'ai_generated' }, 201);

  } catch (e: any) {
    console.error('[generate] Error:', e);
    // Never expose raw SDK errors — they may contain API keys in URL parameters
    return json({ error: 'Failed to generate image. Please try again.' }, 500);
  }
};
