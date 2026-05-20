-- 0009_project_substatus.sql
-- Adds the substatus column to `projects`. The column was referenced throughout
-- the codebase (launch pipeline progress, error storage like "err:...", UI
-- display of "Generating page 2/5", auto-recover stale generations) but was
-- never added during the Supabase → Neon cutover (2026-05-18). Every UPDATE
-- that touched substatus failed with `column "substatus" does not exist`,
-- causing GET /api/projects/:id/launch to 500 in the polling loop after a
-- stuck generation, and POST /launch's atomic IN-filter UPDATE to silently
-- miss (which surfaced as "Cannot launch from status 'brief_ready'").

ALTER TABLE projects ADD COLUMN IF NOT EXISTS substatus TEXT NULL;
