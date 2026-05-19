// Minimal DB API for reel_analyses table. Replaces the Drizzle layer the
// reel-lab repo used. Uses the shared postgres-js client (src/db/index.ts).

import { sql } from '../../db';
import type { AnalysisResult, ProcessingProgress, IntakeAnswers } from './types';

// React components use camelCase, so we surface fields that way.
export interface Analysis {
  id: string;
  userId: string;
  blobUrl: string;
  blobPathname: string;
  fileName: string;
  fileSizeBytes: number;
  status: 'pending' | 'processing' | 'done' | 'failed';
  progress: ProcessingProgress | null;
  result: AnalysisResult | null;
  error: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewAnalysis {
  id: string;
  userId: string;
  blobUrl: string;
  blobPathname: string;
  fileName: string;
  fileSizeBytes: number;
  status?: Analysis['status'];
  progress?: ProcessingProgress | null;
}

// Map snake_case row to legacy reel-lab camelCase shape so the pipeline keeps
// working with minimal edits.
function rowToAnalysis(r: any): Analysis {
  return {
    id: r.id,
    userId: r.user_id,
    blobUrl: r.blob_url,
    blobPathname: r.blob_pathname,
    fileName: r.file_name,
    fileSizeBytes: r.file_size_bytes,
    status: r.status,
    progress: r.progress as ProcessingProgress | null,
    result: r.result as AnalysisResult | null,
    error: r.error as string | null,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

export async function insertAnalysis(a: NewAnalysis): Promise<void> {
  // postgres-js handles JSONB via plain JSON strings when the column type is
  // jsonb — pass JSON.stringify(...) for objects, null otherwise. Using
  // sql.json() inside a tagged template was failing with a type error.
  const progressJson = a.progress ? JSON.stringify(a.progress) : null;
  await sql`
    INSERT INTO reel_analyses (
      id, user_id, blob_url, blob_pathname, file_name, file_size_bytes,
      status, progress
    )
    VALUES (
      ${a.id}, ${a.userId}, ${a.blobUrl}, ${a.blobPathname}, ${a.fileName}, ${a.fileSizeBytes},
      ${a.status ?? 'pending'}, ${progressJson}::jsonb
    )
  `;
}

export async function findAnalysis(id: string): Promise<Analysis | null> {
  const rows = await sql`SELECT * FROM reel_analyses WHERE id = ${id} LIMIT 1`;
  return rows.length > 0 ? rowToAnalysis(rows[0]) : null;
}

export async function listAnalysesByUser(userId: string, limit = 8): Promise<Analysis[]> {
  const rows = await sql`
    SELECT * FROM reel_analyses
    WHERE user_id = ${userId}
    ORDER BY created_at DESC
    LIMIT ${limit}
  `;
  return rows.map(rowToAnalysis);
}

export async function setProgress(id: string, progress: ProcessingProgress): Promise<void> {
  await sql`
    UPDATE reel_analyses
    SET progress = ${JSON.stringify(progress)}::jsonb,
        status = 'processing',
        updated_at = now()
    WHERE id = ${id}
  `;
}

export async function setDone(id: string, result: AnalysisResult): Promise<void> {
  const finalProgress: ProcessingProgress = { step: 'finalizing', pct: 100, message: 'Done' };
  await sql`
    UPDATE reel_analyses
    SET result = ${JSON.stringify(result)}::jsonb,
        progress = ${JSON.stringify(finalProgress)}::jsonb,
        status = 'done',
        updated_at = now()
    WHERE id = ${id}
  `;
}

export async function setFailed(id: string, error: string): Promise<void> {
  await sql`
    UPDATE reel_analyses
    SET status = 'failed', error = ${error}, updated_at = now()
    WHERE id = ${id}
  `;
}

export async function saveIntakeAnswers(id: string, answers: IntakeAnswers): Promise<void> {
  const patch = JSON.stringify({ intakeAnswers: answers });
  await sql`
    UPDATE reel_analyses
    SET progress = COALESCE(progress, '{}'::jsonb) || ${patch}::jsonb,
        updated_at = now()
    WHERE id = ${id}
  `;
}
