-- 007: Create pageviews table for lightweight analytics
-- Receives beacons from generated sites via POST /api/analytics/[projectId]

CREATE TABLE IF NOT EXISTS public.pageviews (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  UUID        NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  url         TEXT,
  referrer    TEXT,
  screen_width INTEGER,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Index for querying pageviews by project (dashboard analytics)
CREATE INDEX idx_pageviews_project_created
  ON public.pageviews (project_id, created_at DESC);

-- Index for time-range queries across all projects
CREATE INDEX idx_pageviews_created
  ON public.pageviews (created_at DESC);

-- RLS: service_role (admin) can insert; authenticated users read their own projects
ALTER TABLE public.pageviews ENABLE ROW LEVEL SECURITY;

-- Allow inserts from service_role (the API endpoint uses admin client)
CREATE POLICY "Service role can insert pageviews"
  ON public.pageviews FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Allow project owners to read their own analytics
CREATE POLICY "Users can read own project pageviews"
  ON public.pageviews FOR SELECT
  TO authenticated
  USING (
    project_id IN (
      SELECT id FROM public.projects WHERE user_id = auth.uid()
    )
  );
