# Savoy Content Studio — Hack A Ton 2026

Text idea → approved image → finished 9:16 reel starring **Domnul Girafă**, operated
end-to-end by a marketing team with zero technical skills.

Challenge: https://hackaton.ambasada.pro/challenges/savoy-content-studio/

## Architecture

```
/studio (Astro page, vanilla JS wizard, Romanian UI)
   │
   ├─ POST /api/studio/reels                    create (mode: scene | giraffe)
   ├─ POST /api/studio/reels/:id/generate-image Higgsfield, identity-locked prompt + girafa.jpg reference
   ├─ GET  /api/studio/reels/:id                status poll — advances async provider jobs
   ├─ POST /api/studio/reels/:id/approve        ★ APPROVAL GATE — no video spend without a human OK
   ├─ POST /api/studio/reels/:id/generate-video scene: image→motion · giraffe: ElevenLabs TTS → HeyGen lip-sync
   └─ GET/POST /api/studio/prompts              reusable prompt library (built-in + user-saved)

Neon Postgres (studio_reels, studio_prompts)  ·  Vercel Blob (image/voice/video artifacts)
```

Serverless-friendly by design: every generation is submit → provider job id → poll.
No background worker; the status endpoint advances the pipeline on each client poll
and archives finished artifacts from expiring provider URLs into Vercel Blob.

## The identity lock

`src/lib/studio/config.ts` carries the verbatim "LOCKED visual asset, DO NOT redesign"
block (colors, straw hat, bow tie, proportions) that is appended to **every** image
prompt in giraffe mode, plus the master reference image (`public/studio/girafa.jpg`,
provided by the sponsor — drop it in before generating).

ElevenLabs voice is pinned exactly to the brief: voice `g8YRbOlJsPkrezcSUiCM`,
`eleven_multilingual_v2`, stability 0.5, similarity 0.75, style 0.0, speaker boost on.

## Cost discipline

- Image must be human-approved (`approved_at`) before any video API is called —
  the server enforces it with a 409, not just the UI.
- `image_attempts` / `video_attempts` counters + an append-only `events` audit log
  per reel.

## Run it

```bash
npm install
node scripts/migrate.mjs                 # applies 0010_studio.sql (additive)
STUDIO_MOCK=1 npm run dev                # full flow on placeholder assets, no keys needed
```

With sponsor keys (kickoff `config.yaml` → env): set `HIGGSFIELD_API_KEY`,
`ELEVENLABS_API_KEY`, `HEYGEN_API_KEY` and remove `STUDIO_MOCK`. Provider payload
shapes live in `src/lib/studio/providers.ts` behind a stable seam — adjust there if
the sponsor endpoints differ.

## Mock smoke test (verified)

create → generate-image → status: image_ready → premature generate-video → **409** →
approve → generate-video → audio_url set → status: complete, video downloadable.
