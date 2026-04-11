-- ========================================
-- USERS (mirrors auth.users)
-- ========================================
CREATE TABLE users (
  id                 UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email              TEXT NOT NULL,
  name               TEXT,
  plan               TEXT DEFAULT 'free' CHECK (plan IN ('free', 'starter', 'pro', 'agency')),
  stripe_customer_id TEXT,
  projects_limit     INTEGER DEFAULT 1,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now()
);

-- Auto-create user profile when a Supabase auth user signs up
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO public.users (id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data->>'full_name'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE PROCEDURE public.handle_new_user();

-- ========================================
-- PROJECTS (one per website)
-- ========================================
CREATE TABLE projects (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            UUID REFERENCES users(id) ON DELETE CASCADE,
  name               TEXT NOT NULL,
  slug               TEXT NOT NULL,
  status             TEXT DEFAULT 'onboarding' CHECK (status IN (
                       'onboarding',
                       'brief_ready',
                       'generating',
                       'generated',
                       'deploying',
                       'live',
                       'failed',
                       'archived'
                     )),
  github_repo        TEXT,
  github_url         TEXT,
  vercel_project_id  TEXT,
  preview_url        TEXT,
  custom_domain      TEXT,
  domain_verified    BOOLEAN DEFAULT false,
  created_at         TIMESTAMPTZ DEFAULT now(),
  updated_at         TIMESTAMPTZ DEFAULT now(),
  deployed_at        TIMESTAMPTZ,

  UNIQUE(user_id, slug)
);

-- ========================================
-- BRIEFS (onboarding output)
-- ========================================
CREATE TABLE briefs (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID UNIQUE REFERENCES projects(id) ON DELETE CASCADE,
  data         JSONB NOT NULL DEFAULT '{}',
  completeness REAL DEFAULT 0.0,
  confirmed    BOOLEAN DEFAULT false,
  confirmed_at TIMESTAMPTZ,
  created_at   TIMESTAMPTZ DEFAULT now(),
  updated_at   TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- CONVERSATIONS (onboarding chat history)
-- ========================================
CREATE TABLE conversations (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id UUID REFERENCES projects(id) ON DELETE CASCADE,
  messages   JSONB NOT NULL DEFAULT '[]',
  phase      TEXT DEFAULT 'discovery',
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- GENERATED FILES (output from generation engine)
-- ========================================
CREATE TABLE generated_files (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id         UUID REFERENCES projects(id) ON DELETE CASCADE,
  version            INTEGER DEFAULT 1,
  files              JSONB NOT NULL,
  generation_cost    REAL,
  generation_tokens  INTEGER,
  created_at         TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- DEPLOYMENTS (deploy history)
-- ========================================
CREATE TABLE deployments (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id     UUID REFERENCES projects(id) ON DELETE CASCADE,
  version        INTEGER DEFAULT 1,
  status         TEXT DEFAULT 'queued' CHECK (status IN (
                   'queued', 'building', 'ready', 'error', 'canceled'
                 )),
  preview_url    TEXT,
  commit_sha     TEXT,
  build_logs     TEXT[],
  build_duration INTEGER,
  error_message  TEXT,
  created_at     TIMESTAMPTZ DEFAULT now(),
  completed_at   TIMESTAMPTZ
);

-- ========================================
-- ASSETS (uploaded files)
-- ========================================
CREATE TABLE assets (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id   UUID REFERENCES projects(id) ON DELETE CASCADE,
  type         TEXT CHECK (type IN ('logo', 'hero', 'section', 'og', 'favicon', 'font', 'other')),
  filename     TEXT NOT NULL,
  storage_path TEXT NOT NULL,
  public_url   TEXT,
  mime_type    TEXT,
  size_bytes   INTEGER,
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- COSTS (per-project AI cost tracking)
-- ========================================
CREATE TABLE costs (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id    UUID REFERENCES projects(id) ON DELETE CASCADE,
  type          TEXT CHECK (type IN ('onboarding', 'generation', 'fix', 'validation')),
  model         TEXT,
  input_tokens  INTEGER,
  output_tokens INTEGER,
  cost_usd      REAL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

-- ========================================
-- INDEXES
-- ========================================
CREATE INDEX idx_projects_user       ON projects(user_id);
CREATE INDEX idx_projects_status     ON projects(status);
CREATE INDEX idx_briefs_project      ON briefs(project_id);
CREATE INDEX idx_conversations_proj  ON conversations(project_id);
CREATE INDEX idx_generated_project   ON generated_files(project_id);
CREATE INDEX idx_deployments_project ON deployments(project_id);
CREATE INDEX idx_assets_project      ON assets(project_id);
CREATE INDEX idx_costs_project       ON costs(project_id);
