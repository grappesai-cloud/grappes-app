// ─── Gemini API Client — Image Generation & Enhancement ─────────────────────
// Uses Gemini 2.0 Flash for both text-to-image and image editing.
// All outputs are returned as base64 buffers ready for WebP conversion.

const GEMINI_MODEL = 'gemini-2.0-flash-exp';
const API_BASE = 'https://generativelanguage.googleapis.com/v1beta';

function getApiKey(): string {
  const key = import.meta.env.GEMINI_API_KEY;
  if (!key) throw new Error('GEMINI_API_KEY not set in environment');
  return key;
}

interface GeminiImageResult {
  buffer: Buffer;
  mimeType: string;
  prompt: string;
}

// ─── Generate Image from Text Prompt ─────────────────────────────────────────

export async function generateImage(prompt: string): Promise<GeminiImageResult> {
  const apiKey = getApiKey();
  const url = `${API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [{ text: prompt }],
      }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        temperature: 0.8,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'Unknown error');
    throw new Error(`Gemini API error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];

  // Find the image part
  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart?.inlineData) {
    throw new Error('Gemini did not return an image');
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType,
    prompt,
  };
}

// ─── Enhance Photo (image-to-image) ─────────────────────────────────────────

export async function enhancePhoto(
  imageBuffer: Buffer,
  imageMimeType: string,
  context: string
): Promise<GeminiImageResult> {
  const apiKey = getApiKey();
  const url = `${API_BASE}/models/${GEMINI_MODEL}:generateContent?key=${apiKey}`;

  const enhancePrompt = `You are a professional photo editor. Enhance this photograph to look like it was taken by a professional photographer with high-end equipment.

Specifically:
- Straighten the horizon and correct perspective distortion
- Improve color balance and white balance for natural, professional tones
- Increase clarity and sharpness without over-processing
- Improve lighting — lift shadows, recover highlights, add depth
- Correct exposure if under/overexposed
- Remove noise and grain from low-light shots
- Make it look editorial and premium, suitable for a luxury website

Context about the business: ${context}

Keep the original composition and subject — only enhance the quality. Output the enhanced image.`;

  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{
        parts: [
          { text: enhancePrompt },
          {
            inlineData: {
              mimeType: imageMimeType,
              data: imageBuffer.toString('base64'),
            },
          },
        ],
      }],
      generationConfig: {
        responseModalities: ['IMAGE', 'TEXT'],
        temperature: 0.4,
      },
    }),
  });

  if (!response.ok) {
    const err = await response.text().catch(() => 'Unknown error');
    throw new Error(`Gemini enhance error ${response.status}: ${err}`);
  }

  const data = await response.json();
  const parts = data?.candidates?.[0]?.content?.parts ?? [];

  const imagePart = parts.find((p: any) => p.inlineData?.mimeType?.startsWith('image/'));
  if (!imagePart?.inlineData) {
    throw new Error('Gemini did not return an enhanced image');
  }

  return {
    buffer: Buffer.from(imagePart.inlineData.data, 'base64'),
    mimeType: imagePart.inlineData.mimeType,
    prompt: enhancePrompt,
  };
}

// ─── Build Generation Prompt from Brief ─────────────────────────────────────

export function buildImagePrompt(brief: Record<string, any>, section: string, variant: string): string {
  const businessName = brief?.business?.name ?? 'the brand';
  const industry = brief?.business?.industry ?? '';
  const description = brief?.business?.description ?? '';
  const style = brief?.branding?.style ?? '';
  const personality = brief?.branding?.personality ?? '';

  const sectionPrompts: Record<string, string> = {
    hero: `Create a stunning hero image for "${businessName}", a ${industry} business. ${description}. The image should feel premium, editorial, and specific to this brand — not generic stock photography. Style: ${style || personality || 'modern and premium'}. Photorealistic, high resolution, dramatic lighting, suitable as a full-width website hero image.`,
    about: `Create a professional editorial photograph representing the story behind "${businessName}", a ${industry} business. Show craftsmanship, authenticity, or the human element. Warm, intimate lighting. Photorealistic, editorial quality.`,
    section: `Create a professional photograph for the "${variant}" section of "${businessName}" website, a ${industry} business. ${description}. Editorial quality, photorealistic, premium feel. The image should feel specific to this brand, not generic.`,
    product: `Create a premium product photography image for "${businessName}", a ${industry} business. Clean or dramatic background, professional lighting, editorial quality. Show the product in its best light.`,
    atmosphere: `Create an atmospheric interior/exterior photograph for "${businessName}", a ${industry} business. Moody, editorial quality, showing the space or environment. Cinematic lighting.`,
  };

  return sectionPrompts[section] || sectionPrompts.section;
}
