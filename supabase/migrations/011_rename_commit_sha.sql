-- Rename commit_sha to vercel_deploy_id for semantic accuracy.
-- The column stores the Vercel deployment ID, not a git commit SHA.

ALTER TABLE deployments RENAME COLUMN commit_sha TO vercel_deploy_id;
