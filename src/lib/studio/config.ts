// ─── Savoy Content Studio: locked brand + provider configuration ─────────────
//
// Everything that is FIXED by the challenge brief lives here:
//  - Domnul Girafă identity lock (must accompany EVERY image prompt)
//  - ElevenLabs voice config (voice ID + settings given by sponsor)
//
// Provider API keys arrive at the hackathon via config.yaml — they map to env
// vars (see .env.example additions). With STUDIO_MOCK=1 the whole pipeline runs
// on placeholder assets so the flow is demoable without any key.

import { e } from '../env';

export const STUDIO_MOCK = () => e('STUDIO_MOCK') === '1' || !e('HIGGSFIELD_API_KEY');

// ── Identity lock ─────────────────────────────────────────────────────────────
// Brief: "DO NOT redesign — LOCKED visual asset" must accompany every AI prompt.
// Master image: public/studio/girafa.jpg (686×1099), provided by sponsor.

export const GIRAFFE_MASTER_IMAGE = '/studio/girafa.jpg';

// Sponsor-provided pose pack (distinct poses from the official asset set).
// In giraffe mode the user can pick one; it rides along with the master image
// as a second reference so the model copies the pose without drifting identity.
export const GIRAFFE_POSES = [
  { id: 'wave',     label: 'Salută',       file: '/studio/poses/wave.png' },
  { id: 'sit',      label: 'Stă turcește', file: '/studio/poses/sit.png' },
  { id: 'walk',     label: 'Se plimbă',    file: '/studio/poses/walk.png' },
  { id: 'dance',    label: 'Dansează',     file: '/studio/poses/dance.png' },
  { id: 'selfie',   label: 'Selfie',       file: '/studio/poses/selfie.png' },
  { id: 'icecream', label: 'Cu înghețată', file: '/studio/poses/icecream.png' },
  { id: 'back',     label: 'Din spate',    file: '/studio/poses/back.png' },
] as const;
export type GiraffePoseId = (typeof GIRAFFE_POSES)[number]['id'];

export const GIRAFFE_IDENTITY_LOCK = `
CHARACTER IDENTITY — LOCKED VISUAL ASSET, DO NOT REDESIGN:
The cartoon giraffe "Domnul Girafă" must match the reference image EXACTLY:
- Body: glossy neon-yellow/gold
- Spots: orange, on legs, back and neck
- Hat: beige/brown straw hat, tilted for comic effect
- Bow tie: orange to red-orange
- Eyes: large and expressive, blue pupils, white sclera, sweet expression
- Outline: clean black outline, 90s–2000s cartoon style
- Proportions: very long neck (~40% of total height), small body, black hooves
Never change colors, proportions, accessories or art style. Same character in every frame.
`.trim();

// ── ElevenLabs (fully specified by the brief) ────────────────────────────────

export const ELEVEN_VOICE_ID = 'g8YRbOlJsPkrezcSUiCM';
export const ELEVEN_MODEL = 'eleven_multilingual_v2';
export const ELEVEN_VOICE_SETTINGS = {
  stability: 0.5,
  similarity_boost: 0.75,
  style: 0.0,
  use_speaker_boost: true,
};

// ── Output spec ───────────────────────────────────────────────────────────────

export const REEL_FORMAT = { width: 1080, height: 1920, aspect: '9:16' } as const;
export const REEL_MIN_SECONDS = 15;
export const REEL_MAX_SECONDS = 30;
