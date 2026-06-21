import { spawn } from "node:child_process";
import { mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

const FFMPEG = ffmpegInstaller.path;
const FFPROBE = ffprobeInstaller.path;

export type VideoMeta = {
  duration_sec: number;
  width: number;
  height: number;
  fps: number;
  aspect_ratio: string;
  file_size_mb: number;
};

export type SceneCut = { time_sec: number };

function run(bin: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const p = spawn(bin, args);
    let out = "";
    let err = "";
    p.stdout.on("data", (d) => (out += d.toString()));
    p.stderr.on("data", (d) => (err += d.toString()));
    p.on("error", (e) => reject(new Error(`spawn ${bin} failed: ${e.message}`)));
    p.on("close", (code) => {
      if (code === 0) resolve(out || err);
      else reject(new Error(`${bin} exited ${code}: ${err.slice(-500)}`));
    });
  });
}

export async function makeWorkDir(): Promise<string> {
  return mkdtemp(join(tmpdir(), "reel-"));
}

export async function downloadToTmp(url: string, dir: string): Promise<string> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const path = join(dir, "input.mp4");
  await writeFile(path, buf);
  return path;
}

export async function probe(videoPath: string): Promise<VideoMeta> {
  const out = await run(FFPROBE, [
    "-v",
    "error",
    "-print_format",
    "json",
    "-show_format",
    "-show_streams",
    videoPath,
  ]);
  const parsed = JSON.parse(out);
  const video = parsed.streams.find(
    (s: { codec_type: string }) => s.codec_type === "video",
  );
  const duration = parseFloat(parsed.format.duration);
  const size = parseInt(parsed.format.size, 10);
  const [num, den] = String(video.r_frame_rate).split("/").map(Number);
  const fps = den ? num / den : 30;
  const w: number = video.width;
  const h: number = video.height;
  const gcd = (a: number, b: number): number => (b ? gcd(b, a % b) : a);
  const g = gcd(w, h);
  return {
    duration_sec: duration,
    width: w,
    height: h,
    fps: Math.round(fps * 100) / 100,
    aspect_ratio: `${w / g}:${h / g}`,
    file_size_mb: Math.round((size / (1024 * 1024)) * 100) / 100,
  };
}

export type FrameZone = "hook" | "scene_change" | "midpoint" | "cta";

export type SampledFrame = {
  path: string;
  sec: number;
  zone: FrameZone;
};

export async function sampleFrames(
  videoPath: string,
  dir: string,
  duration: number,
  sceneCuts: SceneCut[],
): Promise<SampledFrame[]> {
  const stamps: { sec: number; zone: FrameZone }[] = [];

  for (const sec of [0.3, 1.0, 1.8, 2.7]) {
    if (sec < duration) stamps.push({ sec, zone: "hook" });
  }

  const cutFrames = sceneCuts
    .map((c) => c.time_sec + 0.25)
    .filter((t) => t > 3 && t < duration - 5)
    .slice(0, 10);
  for (const sec of cutFrames) {
    stamps.push({ sec, zone: "scene_change" });
  }

  if (cutFrames.length < 3 && duration > 10) {
    for (let i = 1; i <= 3; i++) {
      const sec = (duration / 4) * i;
      if (sec > 3 && sec < duration - 5) {
        stamps.push({ sec, zone: "midpoint" });
      }
    }
  }

  for (const offset of [4.5, 2.5, 0.5]) {
    const sec = duration - offset;
    if (sec > 3) stamps.push({ sec, zone: "cta" });
  }

  stamps.sort((a, b) => a.sec - b.sec);

  const frames: SampledFrame[] = [];
  for (let i = 0; i < stamps.length; i++) {
    const stamp = stamps[i];
    const path = join(dir, `frame_${String(i).padStart(3, "0")}.jpg`);
    await run(FFMPEG, [
      "-y",
      "-ss",
      stamp.sec.toFixed(2),
      "-i",
      videoPath,
      "-frames:v",
      "1",
      "-vf",
      "scale='min(720,iw)':-2",
      "-q:v",
      "3",
      path,
    ]);
    frames.push({ path, sec: stamp.sec, zone: stamp.zone });
  }

  return frames;
}

export type SecondMetric = { sec: number; value: number };

function pairTimeWithMetric(
  out: string,
  metricKey: string,
): { sec: number; value: number }[] {
  const ptsRe = /pts_time:(\d+\.?\d*)/g;
  const valRe = new RegExp(
    `${metricKey.replace(/\./g, "\\.")}=(-?\\d+\\.?\\d*|-?inf)`,
    "g",
  );
  const pts: number[] = [];
  const vals: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = ptsRe.exec(out)) !== null) pts.push(parseFloat(m[1]));
  while ((m = valRe.exec(out)) !== null)
    vals.push(m[1] === "-inf" ? -100 : parseFloat(m[1]));
  const n = Math.min(pts.length, vals.length);
  const result = [];
  for (let i = 0; i < n; i++) result.push({ sec: pts[i], value: vals[i] });
  return result;
}

function bucketBySecond(
  points: { sec: number; value: number }[],
): SecondMetric[] {
  const buckets = new Map<number, number[]>();
  for (const p of points) {
    const sec = Math.floor(p.sec);
    if (!buckets.has(sec)) buckets.set(sec, []);
    buckets.get(sec)!.push(p.value);
  }
  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([sec, vs]) => ({
      sec,
      value:
        Math.round((vs.reduce((s, v) => s + v, 0) / vs.length) * 100) / 100,
    }));
}

export async function loudnessFineGrained(
  videoPath: string,
  durationCapSec = 30,
): Promise<SecondMetric[]> {
  try {
    const out = await run(FFMPEG, [
      "-i",
      videoPath,
      "-t",
      String(durationCapSec),
      "-af",
      "asetnsamples=4000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
      "-vn",
      "-f",
      "null",
      "-",
    ]);
    return pairTimeWithMetric(out, "lavfi.astats.Overall.RMS_level");
  } catch {
    return [];
  }
}

export async function loudnessPerSecond(
  videoPath: string,
): Promise<SecondMetric[]> {
  try {
    const out = await run(FFMPEG, [
      "-i",
      videoPath,
      "-af",
      "asetnsamples=16000,astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level",
      "-vn",
      "-f",
      "null",
      "-",
    ]);
    return bucketBySecond(
      pairTimeWithMetric(out, "lavfi.astats.Overall.RMS_level"),
    );
  } catch {
    return [];
  }
}

export async function motionPerSecond(
  videoPath: string,
): Promise<SecondMetric[]> {
  try {
    const out = await run(FFMPEG, [
      "-i",
      videoPath,
      "-vf",
      "fps=2,scale=160:-2,tblend=all_mode=difference,signalstats,metadata=print:key=lavfi.signalstats.YAVG",
      "-an",
      "-f",
      "null",
      "-",
    ]);
    return bucketBySecond(
      pairTimeWithMetric(out, "lavfi.signalstats.YAVG"),
    );
  } catch {
    return [];
  }
}

export function cutDensityWindows(
  cuts: SceneCut[],
  duration: number,
  windowSec = 5,
): SecondMetric[] {
  const windows: SecondMetric[] = [];
  for (let start = 0; start < duration; start += windowSec) {
    const end = Math.min(start + windowSec, duration);
    const inside = cuts.filter((c) => c.time_sec >= start && c.time_sec < end).length;
    windows.push({ sec: start, value: inside });
  }
  return windows;
}

export async function extractAudio(
  videoPath: string,
  dir: string,
): Promise<string> {
  const audioPath = join(dir, "audio.mp3");
  try {
    await run(FFMPEG, [
      "-y",
      "-i",
      videoPath,
      // Select ONLY the first audio stream. iPhone .MOV files carry extra mebx
      // data/metadata streams (codec "none") that ffmpeg would otherwise try to
      // map into mp3 → "Decoder (codec none) not found". The trailing "?" keeps
      // this from hard-failing when the clip genuinely has no audio track.
      "-map",
      "0:a:0?",
      "-vn",
      "-acodec",
      "libmp3lame",
      "-ar",
      "16000",
      "-ac",
      "1",
      "-b:a",
      "64k",
      audioPath,
    ]);
  } catch (err) {
    // No audio track → ffmpeg writes no streams ("does not contain any stream").
    // That's fine for music/visual reels: leave an empty file so the caller's
    // size check skips transcription instead of crashing the whole pipeline.
    const msg = err instanceof Error ? err.message : String(err);
    if (/does not contain any stream|Output file is empty|Invalid argument/i.test(msg)) {
      await writeFile(audioPath, Buffer.alloc(0));
    } else {
      throw err;
    }
  }
  return audioPath;
}

export async function detectSceneCuts(
  videoPath: string,
  threshold = 0.3,
): Promise<SceneCut[]> {
  try {
    const out = await run(FFMPEG, [
      "-i",
      videoPath,
      "-filter:v",
      `select='gt(scene,${threshold})',showinfo`,
      "-f",
      "null",
      "-",
    ]);
    const cuts: SceneCut[] = [];
    const regex = /pts_time:([\d.]+)/g;
    let m: RegExpExecArray | null;
    while ((m = regex.exec(out)) !== null) {
      cuts.push({ time_sec: parseFloat(m[1]) });
    }
    return cuts;
  } catch {
    return [];
  }
}

export async function frameAsBase64(path: string): Promise<string> {
  const buf = await readFile(path);
  return buf.toString("base64");
}
