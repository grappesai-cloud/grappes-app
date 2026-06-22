-- Per-user tool access allowlist (admin-provisioned accounts).
-- NULL = full access (legacy users + anyone not restricted by the admin).
-- []   = no tools.  [...] = explicit allowlist of tool keys (see src/lib/tools.ts).
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS allowed_tools text[];
