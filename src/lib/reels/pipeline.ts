import { rm, stat } from "node:fs/promises";
import {
  cutDensityWindows,
  detectSceneCuts,
  downloadToTmp,
  extractAudio,
  frameAsBase64,
  loudnessFineGrained,
  loudnessPerSecond,
  makeWorkDir,
  motionPerSecond,
  probe,
  sampleFrames,
} from "./ffmpeg";
import { transcribeAudio } from "./groq";
import { analyzeWithClaude, selfCritique } from "./anthropic";
import { detectNiche, detectContentMode } from "./niche";
import { generateIntake } from "./intake";
import {
  findAnalysis,
  setProgress as dbSetProgress,
  setDone as dbSetDone,
  setFailed as dbSetFailed,
} from "./db";
import type {
  AnalysisResult,
  IntakeAnswers,
  IntakeContext,
  ProcessingProgress,
} from "./types";
import { ensureCompleteDimensions } from "./normalize";

const setProgress = dbSetProgress;
const setDone = dbSetDone;
const setFailed = dbSetFailed;

function downsamplePerSecond<T extends { sec: number; value: number }>(
  samples: T[],
  durationSec: number,
): T[] {
  if (durationSec <= 90 || samples.length <= 90) return samples;
  const stride = durationSec > 180 ? 5 : 2;
  return samples.filter((s) => Math.floor(s.sec) % stride === 0);
}

async function waitForIntakeAnswers(
  id: string,
  timeoutMs = 15 * 60 * 1000,
): Promise<IntakeAnswers | undefined> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const row = await findAnalysis(id);
    const progress = row?.progress as ProcessingProgress | null | undefined;
    if ((progress as any)?.intake_answers) return (progress as any).intake_answers;
    if (row?.status === "failed") return undefined;
    await new Promise((r) => setTimeout(r, 1500));
  }
  return undefined;
}

export async function runAnalysis(id: string, blobUrl: string) {
  let workDir: string | null = null;
  try {
    await setProgress(id, {
      step: "downloading",
      pct: 4,
      message: "Downloading video",
    });
    workDir = await makeWorkDir();
    const videoPath = await downloadToTmp(blobUrl, workDir);

    await setProgress(id, {
      step: "ffmpeg",
      pct: 10,
      message: "Probing video",
    });
    const meta = await probe(videoPath);

    await setProgress(id, {
      step: "ffmpeg",
      pct: 18,
      message: "Detecting scene cuts",
    });
    const sceneCuts = await detectSceneCuts(videoPath);

    await setProgress(id, {
      step: "ffmpeg",
      pct: 28,
      message: "Sampling frames (hook, scenes, CTA)",
    });
    const sampled = await sampleFrames(
      videoPath,
      workDir,
      meta.duration_sec,
      sceneCuts,
    );
    const frames = await Promise.all(
      sampled.map(async (f) => ({
        base64: await frameAsBase64(f.path),
        approx_sec: f.sec,
        zone: f.zone,
      })),
    );

    await setProgress(id, {
      step: "ffmpeg",
      pct: 42,
      message: "Computing motion + loudness metrics",
    });
    const [motion, loudness, loudnessFine] = await Promise.all([
      motionPerSecond(videoPath),
      loudnessPerSecond(videoPath),
      loudnessFineGrained(videoPath, 30),
    ]);
    const cutDensity = cutDensityWindows(sceneCuts, meta.duration_sec);

    await setProgress(id, {
      step: "ffmpeg",
      pct: 52,
      message: "Extracting audio",
    });
    const audioPath = await extractAudio(videoPath, workDir);
    const audioInfo = await stat(audioPath);

    let transcript = "";
    let transcriptResult: Awaited<ReturnType<typeof transcribeAudio>> = {
      text: "",
      has_voice: false,
      language: null,
      segments: [],
    };
    if (audioInfo.size > 1024) {
      await setProgress(id, {
        step: "transcribing",
        pct: 60,
        message: "Transcribing audio",
      });
      transcriptResult = await transcribeAudio(audioPath);
      transcript = transcriptResult.text;
    }

    await setProgress(id, {
      step: "detecting_niche",
      pct: 68,
      message: "Detecting niche",
    });
    const hookFrames = frames
      .filter((f) => f.zone === "hook")
      .map((f) => ({ base64: f.base64, sec: f.approx_sec }));
    const niche = await detectNiche({
      durationSec: meta.duration_sec,
      aspectRatio: meta.aspect_ratio,
      transcript,
      hookFrames,
    });

    // How does this reel communicate? Music-led / no-narration reels are judged
    // as audiovisual edits, not as a spoken message.
    const contentMode = await detectContentMode({
      durationSec: meta.duration_sec,
      transcript,
      hasVoice: transcriptResult.has_voice,
      hookFrames,
    });

    let intakeContext: IntakeContext | undefined;
    let intakeAnswers: IntakeAnswers | undefined;
    if (process.env.INTAKE_DISABLED !== "1") {
      try {
        await setProgress(id, {
          step: "detecting_niche",
          pct: 70,
          message: "Generating intake questions",
        });
        intakeContext = await generateIntake({
          durationSec: meta.duration_sec,
          aspectRatio: meta.aspect_ratio,
          transcript,
          hookFrames,
          niche,
        });
        await setProgress(id, {
          step: "awaiting_intake",
          pct: 72,
          message: "Awaiting your answers before AI analysis",
          intake: intakeContext,
        });
        intakeAnswers = await waitForIntakeAnswers(id);
      } catch (err) {
        console.warn("intake step failed, continuing without it", err);
      }
    }

    await setProgress(id, {
      step: "analyzing",
      pct: 75,
      message: `Analyzing as ${niche.niche} (extended thinking)`,
    });
    const motionDs = downsamplePerSecond(motion, meta.duration_sec);
    const loudnessDs = downsamplePerSecond(loudness, meta.duration_sec);
    const cutDensityDs = downsamplePerSecond(cutDensity, meta.duration_sec);
    const initial = await analyzeWithClaude({
      meta,
      frames,
      sceneCuts,
      transcript,
      motion: motionDs,
      loudness: loudnessDs,
      loudnessFine,
      cutDensity: cutDensityDs,
      niche,
      contentMode,
      intake:
        intakeContext && intakeAnswers
          ? { inferred: intakeContext.inferred, answers: intakeAnswers }
          : undefined,
    });

    let result = initial;
    let critiqueMeta: AnalysisResult["critique_meta"] | undefined;
    if (process.env.ANALYZER_CRITIQUE !== "0") {
      await setProgress(id, {
        step: "critiquing",
        pct: 90,
        message: "Self-critique pass",
      });
      try {
        const critiqued = await selfCritique(initial, {
          meta,
          frames,
          sceneCuts,
          transcript,
          motion: motionDs,
          loudness: loudnessDs,
          loudnessFine,
          cutDensity: cutDensityDs,
          niche,
          contentMode,
          intake:
            intakeContext && intakeAnswers
              ? { inferred: intakeContext.inferred, answers: intakeAnswers }
              : undefined,
        });
        const changes: { field: string; before: string; after: string }[] = [];
        if (critiqued.overall.score !== initial.overall.score) {
          changes.push({
            field: "overall.score",
            before: String(initial.overall.score),
            after: String(critiqued.overall.score),
          });
        }
        if (critiqued.overall.verdict !== initial.overall.verdict) {
          changes.push({
            field: "overall.verdict",
            before: initial.overall.verdict,
            after: critiqued.overall.verdict,
          });
        }
        const beforeWeak = initial.overall.weaknesses ?? [];
        const afterWeak = critiqued.overall.weaknesses ?? [];
        if (afterWeak.length !== beforeWeak.length) {
          changes.push({
            field: "overall.weaknesses.length",
            before: String(beforeWeak.length),
            after: String(afterWeak.length),
          });
        }
        result = critiqued;
        critiqueMeta = {
          passes: 2,
          initial_score: initial.overall.score,
          changes,
        };
      } catch (err) {
        console.warn("self-critique failed, keeping first pass", err);
      }
    }

    await setProgress(id, {
      step: "finalizing",
      pct: 97,
      message: "Saving",
    });
    // Never persist a result with missing sub-dimensions (recover from the
    // first pass, else synthesize) so the analysis page can always render.
    ensureCompleteDimensions(result, initial);
    const finalResult: AnalysisResult = {
      ...result,
      content_mode: contentMode,
      signals: {
        motion,
        loudness,
        cut_density: cutDensity,
        scene_cuts: sceneCuts.map((c) => ({ time_sec: c.time_sec })),
      },
      transcript_segments: transcriptResult.segments,
      critique_meta: critiqueMeta,
    };
    await setDone(id, finalResult);
  } catch (err) {
    console.error("pipeline failed", err);
    await setFailed(
      id,
      err instanceof Error ? err.message : "unknown pipeline error",
    );
  } finally {
    if (workDir) {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
