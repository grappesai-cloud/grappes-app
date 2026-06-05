// ─── Savoy Content Studio: DB access (raw postgres-js via getPg) ─────────────

import { getPg } from '../supabase';

export type StudioMode = 'scene' | 'giraffe';
export type StudioStatus =
  | 'draft'
  | 'image_generating' | 'image_ready' | 'image_failed'
  | 'approved'
  | 'audio_generating'
  | 'video_generating' | 'video_failed'
  | 'complete';

export interface StudioReel {
  id: string;
  user_id: string;
  mode: StudioMode;
  title: string;
  scene_prompt: string;
  dialogue: string | null;
  status: StudioStatus;
  error_message: string | null;
  image_url: string | null;
  audio_url: string | null;
  video_url: string | null;
  provider: string | null;
  provider_job_id: string | null;
  image_attempts: number;
  video_attempts: number;
  approved_at: string | null;
  events: Array<{ at: string; stage: string; msg: string }>;
  created_at: string;
  updated_at: string;
}

// postgres-js can hand jsonb back as a string depending on column inference;
// normalize so callers always see a parsed array.
function hydrate(row: any): StudioReel {
  if (typeof row.events === 'string') {
    try { row.events = JSON.parse(row.events); } catch { row.events = []; }
  }
  return row as StudioReel;
}

export async function getReel(id: string, userId: string): Promise<StudioReel | null> {
  const sql = getPg();
  const rows = await sql`
    SELECT * FROM studio_reels WHERE id = ${id} AND user_id = ${userId} LIMIT 1
  `;
  return rows[0] ? hydrate(rows[0]) : null;
}

export async function listReels(userId: string): Promise<StudioReel[]> {
  const sql = getPg();
  const rows = await sql`
    SELECT * FROM studio_reels WHERE user_id = ${userId} ORDER BY created_at DESC LIMIT 50
  `;
  return rows.map(hydrate);
}

// Patch + append an audit event in one statement.
export async function updateReel(
  id: string,
  patch: Partial<Pick<StudioReel,
    'status' | 'error_message' | 'image_url' | 'audio_url' | 'video_url' |
    'provider' | 'provider_job_id' | 'title'
  >> & { bump?: 'image_attempts' | 'video_attempts'; approve?: boolean; clearError?: boolean },
  event?: { stage: string; msg: string }
): Promise<void> {
  const sql = getPg();
  const ev = event
    ? JSON.stringify([{ at: new Date().toISOString(), ...event }])
    : null;

  await sql`
    UPDATE studio_reels SET
      status          = COALESCE(${patch.status ?? null}, status),
      error_message   = CASE WHEN ${patch.clearError ?? false} THEN NULL
                             ELSE COALESCE(${patch.error_message ?? null}, error_message) END,
      image_url       = COALESCE(${patch.image_url ?? null}, image_url),
      audio_url       = COALESCE(${patch.audio_url ?? null}, audio_url),
      video_url       = COALESCE(${patch.video_url ?? null}, video_url),
      provider        = COALESCE(${patch.provider ?? null}, provider),
      provider_job_id = COALESCE(${patch.provider_job_id ?? null}, provider_job_id),
      title           = COALESCE(${patch.title ?? null}, title),
      image_attempts  = image_attempts + ${patch.bump === 'image_attempts' ? 1 : 0},
      video_attempts  = video_attempts + ${patch.bump === 'video_attempts' ? 1 : 0},
      approved_at     = CASE WHEN ${patch.approve ?? false} THEN now() ELSE approved_at END,
      events          = events || COALESCE(${ev}::jsonb, '[]'::jsonb),
      updated_at      = now()
    WHERE id = ${id}
  `;
}
