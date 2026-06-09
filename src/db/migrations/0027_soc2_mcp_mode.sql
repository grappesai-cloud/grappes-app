-- ============================================
-- 0027_soc2_mcp_mode.sql — SOC 2 Lab: MCP / Agent Security Scan mode
-- ============================================
-- Megatool Phase 1 adds a fourth assessment mode: 'mcp' — a static-first scan of
-- a client's Model Context Protocol deployment (mcpServers config + tool
-- manifests) for agent-security risks: tool poisoning / prompt injection in tool
-- descriptions, rug-pull / unpinned servers, credential exposure, shared-privilege
-- confused-deputy, plaintext transport, excessive permissions. The differentiation
-- wedge — no other SOC 2 readiness tool scans the agent/MCP layer.
--
-- The report JSONB for this mode carries { findings (framework-tagged), roadmap,
-- stats }. No new columns are needed; only the mode CHECK constraint is widened.
--
-- DRIFT NOTE: local migrations lag Neon prod. Confirm the true max in prod
-- `_migrations` and that mode='mcp' is not already present before applying.

ALTER TABLE soc2_assessments
  DROP CONSTRAINT IF EXISTS soc2_assessments_mode_check;

ALTER TABLE soc2_assessments
  ADD CONSTRAINT soc2_assessments_mode_check
  CHECK (mode IN ('code', 'live', 'controls', 'mcp'));
