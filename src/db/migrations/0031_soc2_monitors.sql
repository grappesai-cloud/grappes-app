-- 0031_soc2_monitors.sql
-- Continuous SOC 2 monitoring. A monitor re-scans a target repo on a cadence
-- (the deterministic deep engines: OSV SCA + authz matrix + GitHub evidence — no
-- AI cost) and alerts on drift: a new CVE, a newly-unauthenticated endpoint, a
-- control that regressed (e.g. branch protection turned off). SOC 2 Type II is
-- about controls operating OVER TIME, which a one-shot scan can't show.

CREATE TABLE IF NOT EXISTS soc2_monitors (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL,
  target        text NOT NULL,                       -- repo URL
  cadence       text NOT NULL DEFAULT 'weekly' CHECK (cadence IN ('daily','weekly')),
  active        boolean NOT NULL DEFAULT true,
  last_run_at   timestamptz,
  last_overall  int,
  last_findings int,
  baseline      jsonb,                               -- finding ids from the last run
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, target)
);

CREATE INDEX IF NOT EXISTS soc2_monitors_due ON soc2_monitors (active, last_run_at);
