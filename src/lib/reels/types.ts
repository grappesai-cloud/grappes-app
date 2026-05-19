export type AnalysisStatus = "pending" | "processing" | "done" | "failed";

export type SceneSegment = {
  start_sec: number;
  end_sec: number;
  description: string;
};

export type TextOverlay = {
  text: string;
  appears_at_sec: number;
  duration_sec: number;
  legibility: number;
};

export type RetentionPoint = {
  sec: number;
  retention_pct: number;
};

export type DropPoint = {
  sec: number;
  reason: string;
  severity: "minor" | "moderate" | "severe";
};

export type HookVariation = {
  text: string;
  language: string;
  rationale: string;
  estimated_impact: string;
};

export type Niche =
  | "comedy_skit"
  | "dj_set"
  | "music_performance"
  | "fitness_motivation"
  | "fitness_tutorial"
  | "food_recipe"
  | "food_review"
  | "educational"
  | "vlog_lifestyle"
  | "product_demo"
  | "transformation"
  | "dance_choreo"
  | "fashion_outfit"
  | "thirst_trap"
  | "talking_head"
  | "tech_demo"
  | "asmr"
  | "travel"
  | "other";

export type NicheDetection = {
  niche: Niche;
  confidence: number;
  reasoning: string;
};

export type TimelinePoint = {
  sec: number;
  value: number;
};

export type Moment = {
  sec: number;
  value: number;
  type: "peak" | "dip";
  reason: string;
};

export type Dimension = {
  score: number;
  timeline: TimelinePoint[];
  moments: Moment[];
  summary: string;
};

export type SequenceDimension = {
  score: number;
  summary: string;
};

export type EngagementTimeline = {
  timeline: TimelinePoint[];
  moments: Moment[];
};

export type TranscriptWord = {
  word: string;
  start_sec: number;
  end_sec: number;
};

export type TranscriptSegment = {
  start_sec: number;
  end_sec: number;
  text: string;
  words?: TranscriptWord[];
};

export type SignalSample = { sec: number; value: number };

export type RawSignals = {
  motion: SignalSample[];
  loudness: SignalSample[];
  cut_density: SignalSample[];
  scene_cuts: { time_sec: number }[];
};

export type XSignalId =
  | "hook_velocity"
  | "early_negative_feedback"
  | "pacing_consistency"
  | "av_sync"
  | "niche_fit"
  | "cta_weight"
  | "memorability"
  | "engagement_velocity"
  | "overlay_legibility"
  | "retention_auc";

export type XSignal = {
  id: XSignalId;
  label: string;
  score: number;
  weight: number;
  contribution: number;
  detail: string;
  source: "measured" | "model" | "estimated";
};

export type XRankingSignals = {
  heavy_ranker_score: number;
  band: "throttled" | "neutral" | "boosted";
  signals: XSignal[];
  rationale: string;
};

export type AnalysisResult = {
  meta: {
    duration_sec: number;
    width: number;
    height: number;
    fps: number;
    aspect_ratio: string;
    file_size_mb: number;
  };
  niche: NicheDetection;
  hook: {
    score: number;
    grabs_attention_at_sec: number;
    first_3s_description: string;
    issues: string[];
    suggestions: string[];
    variations: HookVariation[];
  };
  pacing: {
    cuts_per_sec: number;
    total_cuts: number;
    longest_scene_sec: number;
    shortest_scene_sec: number;
    scene_timeline: SceneSegment[];
    pacing_rating: "too_slow" | "good" | "too_fast";
    dead_zones: { start_sec: number; end_sec: number; reason: string }[];
  };
  audio: {
    has_voice: boolean;
    has_music: boolean;
    bpm_estimated: number | null;
    bpm_confidence: "low" | "medium" | "high";
    cuts_on_beat_pct: number | null;
    mood: string;
    transcript: string | null;
    sync_with_visuals: number;
    issues: string[];
  };
  visual: {
    color_palette: string[];
    lighting: "natural" | "studio" | "low_light" | "mixed";
    primary_shot_types: string[];
    visual_quality: number;
    issues: string[];
  };
  text_overlays: TextOverlay[];
  cta: {
    present: boolean;
    type: string | null;
    timing_sec: number | null;
    strength: number;
    issue: string;
    suggestion: string | null;
  };
  retention_estimate: {
    curve: RetentionPoint[];
    drop_points: DropPoint[];
    overall_score: number;
  };
  vibe: {
    primary: string;
    secondary: string[];
    target_audience: string;
  };
  recommended_thumbnail: {
    frame_sec: number;
    reason: string;
  };
  dimensions: {
    voice_impact: Dimension;
    visual_pull: Dimension;
    emotional_hit: Dimension;
    cognitive_grip: SequenceDimension;
    memorability: SequenceDimension;
  };
  engagement: EngagementTimeline;
  signals?: RawSignals;
  transcript_segments?: TranscriptSegment[];
  critique_meta?: CritiqueMeta;
  x_signals?: XRankingSignals;
  overall: {
    score: number;
    verdict: string;
    weaknesses: string[];
    top_3_actions: string[];
    top_3_actions_meta?: ActionMeta[];
  };
};

export type ActionMeta = {
  delta: number;
  rationale: string;
};

export type CritiqueMeta = {
  passes: number;
  initial_score: number;
  changes: { field: string; before: string; after: string }[];
};

export type ProcessingProgress = {
  step:
    | "queued"
    | "downloading"
    | "ffmpeg"
    | "transcribing"
    | "detecting_niche"
    | "awaiting_intake"
    | "analyzing"
    | "critiquing"
    | "finalizing";
  pct: number;
  message: string;
  intake?: IntakeContext;
  intake_answers?: IntakeAnswers;
};

export type IntakeQuestion = {
  id: string;
  label: string;
  helper?: string;
  type: "chip" | "text";
  options?: { value: string; label: string }[];
  inferred_default?: string;
};

export type IntakeContext = {
  inferred: {
    summary: string;
    language: string;
    format_guess: string;
    audience_guess: string;
    confidence: "low" | "medium" | "high";
  };
  questions: IntakeQuestion[];
};

export type IntakeAnswers = Record<string, string>;
