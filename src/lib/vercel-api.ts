import { e } from './env';

const BASE = 'https://api.vercel.com';

function headers() {
  return {
    Authorization: `Bearer ${e('VERCEL_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

function teamParam() {
  const id = e('VERCEL_TEAM_ID');
  return id ? `teamId=${id}` : '';
}

function qs(extra: Record<string, string> = {}) {
  const params = new URLSearchParams(extra);
  const team = e('VERCEL_TEAM_ID');
  if (team) params.set('teamId', team);
  const s = params.toString();
  return s ? `?${s}` : '';
}

async function vercel(path: string, init: RequestInit = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30_000);
  try {
    const res = await fetch(`${BASE}${path}`, { ...init, headers: headers(), signal: controller.signal });
    // Retry once on 429 (rate limited) with backoff
    if (res.status === 429) {
      const retryAfter = parseInt(res.headers.get('retry-after') ?? '5', 10);
      await new Promise(r => setTimeout(r, retryAfter * 1000));
      return fetch(`${BASE}${path}`, { ...init, headers: headers() });
    }
    return res;
  } finally {
    clearTimeout(timeout);
  }
}

// ─── Projects ─────────────────────────────────────────────────────────────────

export interface VercelProject {
  id: string;
  name: string;
  link?: { org?: string; repo?: string; repoId?: number; type?: string };
}

// ─── Deployments ──────────────────────────────────────────────────────────────

export interface VercelDeployment {
  id: string;
  state: string;   // QUEUED | BUILDING | READY | ERROR | CANCELED
  url: string;
  createdAt: number;
}

export async function getLatestDeployment(
  vercelProjectId: string
): Promise<VercelDeployment | null> {
  const res = await vercel(
    `/v6/deployments${qs({ projectId: vercelProjectId, limit: '1' })}`
  );
  if (!res.ok) return null;

  const data = await res.json();
  const dep = data.deployments?.[0];
  if (!dep) return null;

  return {
    id: dep.uid ?? dep.id,
    state: (dep.state ?? dep.readyState ?? 'BUILDING').toUpperCase(),
    url: dep.url ? `https://${dep.url}` : '',
    createdAt: dep.createdAt ?? Date.now(),
  };
}

export async function getDeploymentById(
  deploymentId: string
): Promise<VercelDeployment | null> {
  const res = await vercel(`/v13/deployments/${deploymentId}${qs()}`);
  if (!res.ok) return null;

  const d = await res.json();
  return {
    id: d.id ?? d.uid,
    state: (d.state ?? d.readyState ?? 'BUILDING').toUpperCase(),
    url: d.url ? `https://${d.url}` : '',
    createdAt: d.createdAt ?? Date.now(),
  };
}

// Trigger a deployment from the linked GitHub repo (main branch)
export async function triggerGitDeployment(
  vercelProjectId: string,
  projectName: string,
  githubOrg: string,
  githubRepo: string
): Promise<VercelDeployment | null> {
  const body = {
    name: projectName,
    target: 'production',
    gitSource: {
      type: 'github',
      org: githubOrg,
      repo: githubRepo,
      ref: 'main',
    },
  };

  const res = await vercel(`/v13/deployments${qs()}`, {
    method: 'POST',
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    console.error('[Vercel triggerGitDeployment]', err);
    return null;
  }

  const d = await res.json();
  return {
    id: d.id ?? d.uid,
    state: (d.state ?? d.readyState ?? 'QUEUED').toUpperCase(),
    url: d.url ? `https://${d.url}` : '',
    createdAt: d.createdAt ?? Date.now(),
  };
}

// Poll deployment until READY/ERROR/CANCELED or timeout (default 5 min)
export async function pollDeploymentUntilDone(
  deploymentId: string,
  maxWaitMs = 300_000
): Promise<VercelDeployment> {
  const deadline = Date.now() + maxWaitMs;
  while (Date.now() < deadline) {
    const dep = await getDeploymentById(deploymentId);
    if (dep && ['READY', 'ERROR', 'CANCELED'].includes(dep.state)) return dep;
    await new Promise(r => setTimeout(r, 10_000));
  }
  return (await getDeploymentById(deploymentId)) ?? { id: deploymentId, state: 'ERROR', url: '', createdAt: Date.now() };
}

// Get the production domain (alias) for a Vercel project — e.g. "adsnow.vercel.app"
export async function getProjectProductionUrl(vercelProjectId: string): Promise<string | null> {
  const res = await vercel(`/v9/projects/${encodeURIComponent(vercelProjectId)}${qs()}`);
  if (!res.ok) return null;
  const d = await res.json();

  // targets.production.alias is an array of aliases for the latest production deployment
  const aliases: string[] = d.targets?.production?.alias ?? d.alias ?? [];
  if (aliases.length > 0) {
    // Prefer the shortest alias (the clean one, not the git-branch one)
    const sorted = [...aliases].sort((a, b) => a.length - b.length);
    return `https://${sorted[0]}`;
  }

  // Fallback: project name + .vercel.app
  if (d.name) return `https://${d.name}.vercel.app`;
  return null;
}

// Fetch error log text from a failed Vercel deployment
export async function getDeploymentErrorLog(deploymentId: string): Promise<string> {
  const res = await vercel(`/v3/deployments/${deploymentId}/events${qs({ limit: '100' })}`);
  if (!res.ok) return '';
  const events: any[] = await res.json().catch(() => []);
  const lines = events.map((e: any) => e.payload?.text ?? e.text ?? '').filter(Boolean);
  const full = lines.join('\n');
  // Return last 3000 chars — contains the actual error
  return full.length > 3000 ? full.slice(-3000) : full;
}
