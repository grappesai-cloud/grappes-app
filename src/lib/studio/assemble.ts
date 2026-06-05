// ─── Savoy Content Studio: final assembly ─────────────────────────────────────
//
// The brief requires the final reel to be 15-30s. Scene mode produces an ~8s
// motion clip (Seedance), so we loop it 3x via ffmpeg concat with stream copy:
// no re-encode, finishes in ~1-2s, runs fine inside a Vercel function via the
// ffmpeg-static binary. Giraffe mode needs no assembly (duration = voice).

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { writeFile, readFile, rm, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { put } from '@vercel/blob';
import ffmpegPath from 'ffmpeg-static';
import { e } from '../env';

const exec = promisify(execFile);
const LOOPS = 3; // 8s clip → 24s final, inside the 15-30s spec

export async function assembleSceneReel(clipUrl: string, reelId: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'savoy-'));
  try {
    // Fetch the raw clip (provider URL or local mock asset already fetched by caller)
    const res = await fetch(clipUrl);
    if (!res.ok) throw new Error(`Assembly fetch failed: ${res.status}`);
    const clip = join(dir, 'clip.mp4');
    await writeFile(clip, Buffer.from(await res.arrayBuffer()));

    // Concat the same file N times with stream copy (identical codec params by
    // construction, so -c copy is safe and there is no quality loss).
    const list = join(dir, 'list.txt');
    await writeFile(list, Array(LOOPS).fill(`file '${clip}'`).join('\n'));
    const out = join(dir, 'final.mp4');
    await exec(ffmpegPath as unknown as string, [
      '-y', '-f', 'concat', '-safe', '0', '-i', list,
      '-c', 'copy', '-movflags', '+faststart', out,
    ], { timeout: 120_000 });

    const blob = await put(`studio/${reelId}/reel-final.mp4`, await readFile(out), {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: true,
      token: e('BLOB_READ_WRITE_TOKEN'),
    });
    return blob.url;
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {});
  }
}
