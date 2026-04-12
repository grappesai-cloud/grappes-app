-- ============================================================
-- 014: Enable Supabase Realtime on projects table
-- Run this in Supabase SQL Editor
-- ============================================================

-- Enable Realtime for the projects table
ALTER PUBLICATION supabase_realtime ADD TABLE public.projects;

-- RLS is already enabled on projects (from 013),
-- so only the project owner will receive change events.
