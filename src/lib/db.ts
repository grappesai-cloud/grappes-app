import { createAdminClient } from './supabase';

// ──────────────────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────────────────

export type UserPlan = 'free' | 'starter' | 'pro' | 'agency' | 'owner';
// DB storage type — includes 'free'. For paid-only contexts use SiteBillingType from site-billing.ts
export type SiteBillingType = 'free' | 'monthly' | 'annual' | 'lifetime';
export type SiteBillingStatus = 'free' | 'active' | 'expired';
export type ProjectStatus =
  | 'onboarding'
  | 'brief_ready'
  | 'generating'
  | 'generated'
  | 'deploying'
  | 'live'
  | 'failed'
  | 'archived';
export type DeploymentStatus = 'queued' | 'building' | 'ready' | 'error' | 'canceled';
export type AssetType = 'logo' | 'hero' | 'section' | 'og' | 'favicon' | 'font' | 'menu' | 'video' | 'other';
export type CostType = 'onboarding' | 'generation' | 'fix' | 'validation';
export type ConversationPhase =
  | 'discovery'
  | 'content'
  | 'branding'
  | 'media'
  | 'preferences'
  | 'review';

export interface User {
  id: string;
  email: string;
  name?: string | null;
  plan: UserPlan;
  stripe_customer_id?: string | null;
  projects_limit: number;
  multipage_addon?: boolean | null;
  multipage_addon_lifetime?: boolean | null;
  multipage_addon_subscription_id?: string | null;
  created_at: string;
  updated_at: string;
}

export interface Project {
  id: string;
  user_id: string;
  name: string;
  slug: string;
  status: ProjectStatus;
  substatus?: string | null;
  github_repo?: string | null;
  github_url?: string | null;
  vercel_project_id?: string | null;
  preview_url?: string | null;
  custom_domain?: string | null;
  domain_verified: boolean;
  billing_type: SiteBillingType;
  billing_status: SiteBillingStatus;
  site_subscription_id?: string | null;
  site_payment_intent_id?: string | null;
  activated_at?: string | null;
  expires_at?: string | null;
  created_at: string;
  updated_at: string;
  deployed_at?: string | null;
}

export interface Brief {
  id: string;
  project_id: string;
  data: Record<string, any>;
  completeness: number;
  confirmed: boolean;
  confirmed_at?: string | null;
  created_at: string;
  updated_at: string;
}

export interface ConversationMessage {
  role: 'user' | 'assistant';
  content: string;
  timestamp: string;
}

export interface Conversation {
  id: string;
  project_id: string;
  messages: ConversationMessage[];
  phase: ConversationPhase;
  created_at: string;
  updated_at: string;
}

export interface GeneratedFile {
  id: string;
  project_id: string;
  version: number;
  files: Record<string, string>;
  generation_cost?: number | null;
  generation_tokens?: number | null;
  created_at: string;
}

export interface Deployment {
  id: string;
  project_id: string;
  version: number;
  status: DeploymentStatus;
  preview_url?: string | null;
  vercel_deploy_id?: string | null;
  build_logs?: string[] | null;
  build_duration?: number | null;
  error_message?: string | null;
  created_at: string;
  completed_at?: string | null;
}

export interface Asset {
  id: string;
  project_id: string;
  type: AssetType;
  filename: string;
  storage_path: string;
  public_url?: string | null;
  mime_type?: string | null;
  size_bytes?: number | null;
  metadata?: Record<string, any> | null;
  created_at: string;
}

export interface Cost {
  id: string;
  project_id: string;
  type: CostType;
  model?: string | null;
  input_tokens?: number | null;
  output_tokens?: number | null;
  cost_usd?: number | null;
  created_at: string;
}

// ──────────────────────────────────────────────────────────
// Helpers
// ──────────────────────────────────────────────────────────

function getClient() {
  return createAdminClient();
}

const now = () => new Date().toISOString();

// ──────────────────────────────────────────────────────────
// DB query helpers
// ──────────────────────────────────────────────────────────

export const db = {
  // ── USERS ──────────────────────────────────────────────
  users: {
    async findById(id: string): Promise<User | null> {
      const { data } = await getClient()
        .from('users')
        .select('*')
        .eq('id', id)
        .single();
      return (data as User | null) ?? null;
    },
  },

  // ── PROJECTS ───────────────────────────────────────────
  projects: {
    async create(userId: string, name: string, slug: string): Promise<Project> {
      const { data, error } = await getClient()
        .from('projects')
        .insert({ user_id: userId, name, slug })
        .select('*')
        .single();
      if (error) throw error;
      return data as Project;
    },

    async findByUser(userId: string): Promise<Project[]> {
      const { data, error } = await getClient()
        .from('projects')
        .select('*')
        .eq('user_id', userId)
        .neq('status', 'archived')
        .order('updated_at', { ascending: false });
      if (error) throw error;
      return (data as Project[]) ?? [];
    },

    async findById(id: string): Promise<Project | null> {
      const { data } = await getClient()
        .from('projects')
        .select('*')
        .eq('id', id)
        .single();
      return (data as Project | null) ?? null;
    },

    async updateStatus(id: string, status: ProjectStatus): Promise<void> {
      const updates: Record<string, any> = { status, updated_at: now() };
      if (status === 'live') updates.deployed_at = now();
      if (['live', 'failed', 'generated'].includes(status)) updates.substatus = null;
      const { error } = await getClient().from('projects').update(updates).eq('id', id);
      if (error) throw error;
    },

    async updateSubstatus(id: string, substatus: string | null): Promise<void> {
      const { error } = await getClient()
        .from('projects')
        .update({ substatus, updated_at: now() })
        .eq('id', id);
      if (error) throw error;
    },

    async update(
      id: string,
      data: Partial<
        Pick<
          Project,
          | 'name'
          | 'custom_domain'
          | 'github_repo'
          | 'github_url'
          | 'vercel_project_id'
          | 'preview_url'
          | 'domain_verified'
        >
      >
    ): Promise<Project> {
      const { data: updated, error } = await getClient()
        .from('projects')
        .update({ ...data, updated_at: now() })
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return updated as Project;
    },

    async archive(id: string): Promise<void> {
      const { error } = await getClient()
        .from('projects')
        .update({ status: 'archived', updated_at: now() })
        .eq('id', id);
      if (error) throw error;
    },

    async countByUser(userId: string): Promise<number> {
      // Count ALL projects including archived — prevents delete+recreate quota bypass
      const { count, error } = await getClient()
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId);
      if (error) throw error;
      return count ?? 0;
    },

    /** Count projects with billing_status = 'free' (unactivated, non-archived) for a user */
    async countFree(userId: string): Promise<number> {
      const { count, error } = await getClient()
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('billing_status', 'free')
        .neq('status', 'archived');
      if (error) throw error;
      return count ?? 0;
    },

    /** Count projects with billing_status = 'active' for a user */
    async countActive(userId: string): Promise<number> {
      const { count, error } = await getClient()
        .from('projects')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('billing_status', 'active');
      if (error) throw error;
      return count ?? 0;
    },

    async updateBilling(
      id: string,
      data: Partial<Pick<Project,
        | 'billing_type'
        | 'billing_status'
        | 'site_subscription_id'
        | 'site_payment_intent_id'
        | 'activated_at'
        | 'expires_at'
      >>
    ): Promise<void> {
      const { error } = await getClient()
        .from('projects')
        .update({ ...data, updated_at: now() })
        .eq('id', id);
      if (error) throw error;
    },

    /** Set 7-day free expiry when a free site goes live */
    async setFreeExpiry(id: string): Promise<void> {
      const { getFreeExpiresAt } = await import('./site-billing');
      const { error } = await getClient()
        .from('projects')
        .update({ expires_at: getFreeExpiresAt(), updated_at: now() })
        .eq('id', id);
      if (error) throw error;
    },

    async slugExists(slug: string, userId: string): Promise<boolean> {
      const { data } = await getClient()
        .from('projects')
        .select('id')
        .eq('slug', slug)
        .eq('user_id', userId)
        .maybeSingle();
      return !!data;
    },
  },

  // ── BRIEFS ─────────────────────────────────────────────
  briefs: {
    async findByProjectId(projectId: string): Promise<Brief | null> {
      const { data } = await getClient()
        .from('briefs')
        .select('*')
        .eq('project_id', projectId)
        .single();
      return (data as Brief | null) ?? null;
    },

    async update(projectId: string, data: Record<string, any>, completeness: number): Promise<Brief> {
      const { data: updated, error } = await getClient()
        .from('briefs')
        .update({ data, completeness, updated_at: now() })
        .eq('project_id', projectId)
        .select('*')
        .single();
      if (error) throw error;
      return updated as Brief;
    },

    /**
     * Merge extracted data (dot-path keys) into the existing brief.
     * Arrays are appended; scalars overwrite.
     * Implements ONBOARDING.md Section 4.4.
     */
    async merge(projectId: string, extracted: Record<string, any>): Promise<Brief> {
      const brief = await db.briefs.findByProjectId(projectId);
      const briefData = structuredClone(brief?.data ?? {});

      for (const [dotPath, value] of Object.entries(extracted)) {
        const keys = dotPath.split('.');
        let target: any = briefData;

        for (let i = 0; i < keys.length - 1; i++) {
          if (!target[keys[i]] || typeof target[keys[i]] !== 'object') {
            target[keys[i]] = {};
          }
          target = target[keys[i]];
        }

        const finalKey = keys[keys.length - 1];
        if (Array.isArray(target[finalKey]) && !Array.isArray(value)) {
          // Single item added to existing array (e.g. "also add photography")
          target[finalKey].push(value);
        } else {
          // Everything else: overwrite (including array→array corrections)
          target[finalKey] = value;
        }
      }

      return await db.briefs.update(projectId, briefData, brief?.completeness ?? 0);
    },

    async confirm(projectId: string): Promise<Brief> {
      const { data, error } = await getClient()
        .from('briefs')
        .update({ confirmed: true, confirmed_at: now(), updated_at: now() })
        .eq('project_id', projectId)
        .select('*')
        .single();
      if (error) throw error;
      return data as Brief;
    },
  },

  // ── CONVERSATIONS ──────────────────────────────────────
  conversations: {
    async findByProjectId(projectId: string): Promise<Conversation | null> {
      const { data } = await getClient()
        .from('conversations')
        .select('*')
        .eq('project_id', projectId)
        .single();
      return (data as Conversation | null) ?? null;
    },

    async appendMessage(projectId: string, message: ConversationMessage): Promise<void> {
      const conv = await db.conversations.findByProjectId(projectId);
      if (!conv) throw new Error('Conversation not found');
      const messages = [...conv.messages, message];
      const { error } = await getClient()
        .from('conversations')
        .update({ messages, updated_at: now() })
        .eq('project_id', projectId);
      if (error) throw error;
    },

    async updatePhase(projectId: string, phase: ConversationPhase): Promise<void> {
      const { error } = await getClient()
        .from('conversations')
        .update({ phase, updated_at: now() })
        .eq('project_id', projectId);
      if (error) throw error;
    },
  },

  // ── DEPLOYMENTS ────────────────────────────────────────
  deployments: {
    async create(projectId: string, version = 1): Promise<Deployment> {
      const { data, error } = await getClient()
        .from('deployments')
        .insert({ project_id: projectId, version })
        .select('*')
        .single();
      if (error) throw error;
      return data as Deployment;
    },

    async findByProject(projectId: string): Promise<Deployment[]> {
      const { data, error } = await getClient()
        .from('deployments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Deployment[]) ?? [];
    },

    async findLatest(projectId: string): Promise<Deployment | null> {
      const { data } = await getClient()
        .from('deployments')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as Deployment | null) ?? null;
    },

    async updateStatus(
      id: string,
      status: DeploymentStatus,
      extra?: Partial<Pick<Deployment, 'preview_url' | 'vercel_deploy_id' | 'build_logs' | 'build_duration' | 'error_message'>>
    ): Promise<void> {
      const terminal = ['ready', 'error', 'canceled'];
      const updates: Record<string, any> = {
        status,
        ...(extra ?? {}),
        ...(terminal.includes(status) ? { completed_at: now() } : {}),
      };
      const { error } = await getClient().from('deployments').update(updates).eq('id', id);
      if (error) throw error;
    },
  },

  // ── ASSETS ─────────────────────────────────────────────
  assets: {
    async create(data: {
      project_id: string;
      type: AssetType;
      filename: string;
      storage_path: string;
      public_url?: string;
      mime_type?: string;
      size_bytes?: number;
      metadata?: Record<string, any>;
    }): Promise<Asset> {
      const { data: asset, error } = await getClient()
        .from('assets')
        .insert(data)
        .select('*')
        .single();
      if (error) throw error;
      return asset as Asset;
    },

    async findByProject(projectId: string): Promise<Asset[]> {
      const { data, error } = await getClient()
        .from('assets')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Asset[]) ?? [];
    },

    async findByProjectAndType(projectId: string, type: AssetType): Promise<Asset[]> {
      const { data, error } = await getClient()
        .from('assets')
        .select('*')
        .eq('project_id', projectId)
        .eq('type', type)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data as Asset[]) ?? [];
    },

    async findById(id: string): Promise<Asset | null> {
      const { data } = await getClient()
        .from('assets')
        .select('*')
        .eq('id', id)
        .single();
      return (data as Asset | null) ?? null;
    },

    async update(
      id: string,
      data: Partial<Pick<Asset, 'type' | 'metadata'>>
    ): Promise<Asset> {
      const { data: updated, error } = await getClient()
        .from('assets')
        .update(data)
        .eq('id', id)
        .select('*')
        .single();
      if (error) throw error;
      return updated as Asset;
    },

    async delete(id: string): Promise<void> {
      const { error } = await getClient().from('assets').delete().eq('id', id);
      if (error) throw error;
    },
  },

  // ── GENERATED FILES ────────────────────────────────────
  generatedFiles: {
    async create(data: {
      project_id: string;
      version: number;
      files: Record<string, string>;
      generation_cost?: number;
      generation_tokens?: number;
    }): Promise<GeneratedFile> {
      const { data: file, error } = await getClient()
        .from('generated_files')
        .insert(data)
        .select('*')
        .single();
      if (error) throw error;
      return file as GeneratedFile;
    },

    async findLatest(projectId: string): Promise<GeneratedFile | null> {
      const { data } = await getClient()
        .from('generated_files')
        .select('*')
        .eq('project_id', projectId)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      return (data as GeneratedFile | null) ?? null;
    },

    async update(id: string, data: Partial<{ files: Record<string, string> }>): Promise<void> {
      const { error } = await getClient()
        .from('generated_files')
        .update(data)
        .eq('id', id);
      if (error) throw error;
    },

    // Merges updated files (e.g. __visual-qa.json) into the latest record.
    async upsertQAReport(
      projectId: string,
      version: number,
      files: Record<string, string>
    ): Promise<void> {
      const { error } = await getClient()
        .from('generated_files')
        .update({ files })
        .eq('project_id', projectId)
        .eq('version', version);
      if (error) throw error;
    },
  },

  // ── COSTS ──────────────────────────────────────────────
  costs: {
    async create(data: {
      project_id: string;
      type: CostType;
      model: string;
      input_tokens: number;
      output_tokens: number;
      cost_usd: number;
    }): Promise<Cost> {
      const { data: cost, error } = await getClient()
        .from('costs')
        .insert(data)
        .select('*')
        .single();
      if (error) throw error;
      return cost as Cost;
    },
  },
};
