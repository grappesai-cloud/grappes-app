import Groq from "groq-sdk";
import { createReadStream } from "node:fs";
import type { TranscriptSegment } from "./types";

let _groq: Groq | null = null;
function groq(): Groq {
  if (!_groq) {
    _groq = new Groq({ apiKey: process.env.GROQ_API_KEY });
  }
  return _groq;
}

export type TranscriptionResult = {
  text: string;
  has_voice: boolean;
  language: string | null;
  segments: TranscriptSegment[];
};

type WhisperSegment = {
  start: number;
  end: number;
  text: string;
  words?: { word: string; start: number; end: number }[];
};

export async function transcribeAudio(
  audioPath: string,
): Promise<TranscriptionResult> {
  try {
    const req: Record<string, unknown> = {
      file: createReadStream(audioPath),
      model: "whisper-large-v3-turbo",
      response_format: "verbose_json",
      timestamp_granularities: ["segment", "word"],
    };
    const res = (await (
      groq().audio.transcriptions.create as unknown as (
        body: Record<string, unknown>,
      ) => Promise<unknown>
    )(req)) as {
      text?: string;
      language?: string;
      segments?: WhisperSegment[];
    };
    const text = (res.text ?? "").trim();
    const segments: TranscriptSegment[] = (res.segments ?? []).map((s) => ({
      start_sec: s.start,
      end_sec: s.end,
      text: s.text.trim(),
      words: s.words?.map((w) => ({
        word: w.word.trim(),
        start_sec: w.start,
        end_sec: w.end,
      })),
    }));
    return {
      text,
      has_voice: text.length > 4,
      language: res.language ?? null,
      segments,
    };
  } catch (err) {
    console.error("groq transcription failed", err);
    return { text: "", has_voice: false, language: null, segments: [] };
  }
}
