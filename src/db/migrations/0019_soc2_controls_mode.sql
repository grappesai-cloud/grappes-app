-- ============================================
-- 0019_soc2_controls_mode.sql — SOC 2 Lab: controls self-assessment mode
-- ============================================
-- Slice 5 adds a third assessment mode: 'controls' — an organizational/process
-- questionnaire mapped to the Trust Service Criteria (the ~70% of SOC 2 that
-- code scanning and live recon cannot see: governance, access reviews, change
-- management, vendor risk, incident response, backups, privacy).
--
-- The report JSONB for this mode carries { findings, roadmap, coverage }.
-- No new columns are needed; only the mode CHECK constraint is widened.

ALTER TABLE soc2_assessments
  DROP CONSTRAINT IF EXISTS soc2_assessments_mode_check;

ALTER TABLE soc2_assessments
  ADD CONSTRAINT soc2_assessments_mode_check
  CHECK (mode IN ('code', 'live', 'controls'));
