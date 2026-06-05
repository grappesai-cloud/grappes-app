// ─── Savoy Content Studio: generation providers ──────────────────────────────
//
// All heavy generation is external (submit → jobId → poll), which keeps our
// Vercel functions short-lived. Three seams:
//   image:   text + giraffe reference image → identity-locked still (Higgsfield)
//   tts:     Romanian dialogue → mp3 (ElevenLabs — synchronous, fully specced)
//   video:   approved image (+ audio for lip-sync) → 9:16 clip (Kling / HeyGen)
//
// STUDIO_MOCK=1 (or missing keys) routes everything to deterministic mock jobs
// backed by placeholder assets in /public/studio/ — the full UX flow works
// before the sponsor's config.yaml + API keys arrive.

import { put } from '@vercel/blob';
import { e } from '../env';
import {
  STUDIO_MOCK,
  GIRAFFE_IDENTITY_LOCK,
  ELEVEN_VOICE_ID,
  ELEVEN_MODEL,
  ELEVEN_VOICE_SETTINGS,
  REEL_FORMAT,
} from './config';

export type JobStatus =
  | { state: 'pending'; progress?: number }
  | { state: 'complete'; url: string }
  | { state: 'failed'; error: string };

// ── Mock provider ─────────────────────────────────────────────────────────────
// jobId encodes its own completion time: `mock:<readyAtMs>:<kind>`. Polling is
// pure — no state, survives serverless cold starts.

const MOCK_ASSETS: Record<string, string> = {
  image: '/studio/mock-image.jpg',
  video: '/studio/mock-video.mp4',
};

function mockSubmit(kind: 'image' | 'video', delayMs: number): string {
  return `mock:${Date.now() + delayMs}:${kind}`;
}

function mockPoll(jobId: string): JobStatus {
  const [, readyAt, kind] = jobId.split(':');
  const remaining = Number(readyAt) - Date.now();
  if (remaining > 0) {
    return { state: 'pending', progress: Math.max(5, Math.min(95, 100 - Math.round(remaining / 100))) };
  }
  return { state: 'complete', url: MOCK_ASSETS[kind] ?? MOCK_ASSETS.image };
}

// ── Image generation (Higgsfield platform) ────────────────────────────────────
// Models pinned by the sponsor brief (savoy-content-studio.docx):
//   mode 'scene'   → GPT Image 2 (no giraffe)
//   mode 'giraffe' → Nano Banana, identity-locked with girafa.jpg reference
//   scene video    → Seedance 2.0
// TODO(kickoff): confirm endpoint + payload field names against config.yaml.
// The seam is stable: prompt + optional reference image in, jobId out, poll until URL.

const HIGGSFIELD_BASE = e('HIGGSFIELD_API_BASE') || 'https://platform.higgsfield.ai/v1';
const IMAGE_MODEL_SCENE = 'gpt-image-2';
const IMAGE_MODEL_GIRAFFE = 'nano-banana';
const VIDEO_MODEL_SCENE = 'seedance-2.0';

export async function submitImage(opts: {
  scenePrompt: string;
  withGiraffe: boolean;
  refImageUrl?: string; // absolute URL to girafa.jpg master
}): Promise<{ jobId: string; provider: string }> {
  if (STUDIO_MOCK()) {
    return { jobId: mockSubmit('image', 6_000), provider: 'mock' };
  }

  const prompt = opts.withGiraffe
    ? `${opts.scenePrompt}\n\n${GIRAFFE_IDENTITY_LOCK}`
    : `${opts.scenePrompt}\n\nStyle: bright, premium hotel marketing photo-illustration, ${REEL_FORMAT.aspect} vertical composition.`;

  const res = await fetch(`${HIGGSFIELD_BASE}/images/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${e('HIGGSFIELD_API_KEY')}`,
    },
    body: JSON.stringify({
      model: opts.withGiraffe ? IMAGE_MODEL_GIRAFFE : IMAGE_MODEL_SCENE,
      prompt,
      aspect_ratio: REEL_FORMAT.aspect,
      ...(opts.withGiraffe && opts.refImageUrl
        ? { reference_images: [opts.refImageUrl], reference_strength: 0.85 }
        : {}),
    }),
  });
  if (!res.ok) throw new Error(`Higgsfield image submit failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { jobId: data.id ?? data.job_id, provider: 'higgsfield' };
}

export async function pollImage(provider: string, jobId: string): Promise<JobStatus> {
  if (provider === 'mock') return mockPoll(jobId);

  const res = await fetch(`${HIGGSFIELD_BASE}/jobs/${jobId}`, {
    headers: { Authorization: `Bearer ${e('HIGGSFIELD_API_KEY')}` },
  });
  if (!res.ok) return { state: 'failed', error: `Higgsfield poll failed: ${res.status}` };
  const data = await res.json();
  if (data.status === 'completed' && (data.output?.url || data.url)) {
    return { state: 'complete', url: data.output?.url ?? data.url };
  }
  if (data.status === 'failed') return { state: 'failed', error: data.error ?? 'Image generation failed' };
  return { state: 'pending', progress: data.progress };
}

// ── TTS (ElevenLabs) — synchronous, returns audio bytes ───────────────────────
// Voice + settings are LOCKED by the brief. Returns a Vercel Blob URL.

export async function generateSpeech(text: string, reelId: string): Promise<string> {
  if (STUDIO_MOCK()) {
    // No mock mp3 baked in: in mock mode the video step just uses the mock clip.
    return '/studio/mock-audio.mp3';
  }

  const res = await fetch(
    `https://api.elevenlabs.io/v1/text-to-speech/${ELEVEN_VOICE_ID}?output_format=mp3_44100_128`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'xi-api-key': e('ELEVENLABS_API_KEY')!,
      },
      body: JSON.stringify({
        text,
        model_id: ELEVEN_MODEL,
        voice_settings: ELEVEN_VOICE_SETTINGS,
      }),
    }
  );
  if (!res.ok) throw new Error(`ElevenLabs TTS failed: ${res.status} ${await res.text()}`);

  const audio = Buffer.from(await res.arrayBuffer());
  const blob = await put(`studio/${reelId}/voice.mp3`, audio, {
    access: 'public',
    contentType: 'audio/mpeg',
    addRandomSuffix: true,
  });
  return blob.url;
}

// ── Video generation ──────────────────────────────────────────────────────────
// Mode 'scene':   image → ~8s motion clip (Higgsfield/Seedance image-to-video).
// Mode 'giraffe': image + voice mp3 → lip-synced talking clip (HeyGen/Kling).
// TODO(kickoff): confirm payload shapes against config.yaml.

const HEYGEN_BASE = e('HEYGEN_API_BASE') || 'https://api.heygen.com/v2';

export async function submitVideo(opts: {
  imageUrl: string;
  scenePrompt: string;
  audioUrl?: string; // present → lip-sync path
}): Promise<{ jobId: string; provider: string }> {
  if (STUDIO_MOCK()) {
    return { jobId: mockSubmit('video', 12_000), provider: 'mock' };
  }

  if (opts.audioUrl) {
    // Lip-sync: HeyGen photo-avatar from the approved giraffe image + ElevenLabs mp3.
    const res = await fetch(`${HEYGEN_BASE}/video/generate`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-Key': e('HEYGEN_API_KEY')!,
      },
      body: JSON.stringify({
        dimension: { width: REEL_FORMAT.width, height: REEL_FORMAT.height },
        video_inputs: [
          {
            character: { type: 'talking_photo_image', image_url: opts.imageUrl },
            voice: { type: 'audio', audio_url: opts.audioUrl },
          },
        ],
      }),
    });
    if (!res.ok) throw new Error(`HeyGen submit failed: ${res.status} ${await res.text()}`);
    const data = await res.json();
    return { jobId: data.data?.video_id ?? data.video_id, provider: 'heygen' };
  }

  // Scene motion: image-to-video.
  const res = await fetch(`${HIGGSFIELD_BASE}/videos/generations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${e('HIGGSFIELD_API_KEY')}`,
    },
    body: JSON.stringify({
      model: VIDEO_MODEL_SCENE,
      image_url: opts.imageUrl,
      prompt: `Subtle cinematic camera motion. ${opts.scenePrompt}`,
      aspect_ratio: REEL_FORMAT.aspect,
      duration: 8,
    }),
  });
  if (!res.ok) throw new Error(`Higgsfield video submit failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  return { jobId: data.id ?? data.job_id, provider: 'higgsfield' };
}

export async function pollVideo(provider: string, jobId: string): Promise<JobStatus> {
  if (provider === 'mock') return mockPoll(jobId);

  if (provider === 'heygen') {
    const res = await fetch(`${HEYGEN_BASE.replace('/v2', '/v1')}/video_status.get?video_id=${jobId}`, {
      headers: { 'X-Api-Key': e('HEYGEN_API_KEY')! },
    });
    if (!res.ok) return { state: 'failed', error: `HeyGen poll failed: ${res.status}` };
    const data = await res.json();
    const s = data.data?.status ?? data.status;
    if (s === 'completed') return { state: 'complete', url: data.data?.video_url ?? data.video_url };
    if (s === 'failed') return { state: 'failed', error: data.data?.error?.message ?? 'Video generation failed' };
    return { state: 'pending' };
  }

  return pollImage(provider, jobId); // Higgsfield uses the same jobs endpoint
}

// ── Persist external artifacts to our Blob (provider URLs expire) ────────────

export async function archiveToBlob(externalUrl: string, path: string, contentType: string): Promise<string> {
  if (externalUrl.startsWith('/')) return externalUrl; // local mock asset
  const res = await fetch(externalUrl);
  if (!res.ok) throw new Error(`Archive fetch failed: ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  const blob = await put(path, bytes, { access: 'public', contentType, addRandomSuffix: true });
  return blob.url;
}
