// ── SOC 2 deep engines: real SCA + gray-box authz over the FULL repo ───────
// The bounded 40-file fetch used for the AI code audit excludes the lockfile and
// most route files, so the deep engines fetch exactly what they need directly
// from GitHub: the dependency lockfile (for OSV SCA) and every API route file
// (for the static authz matrix). Runs in a serverless function — no binaries.

import { parseGitHubUrl } from './fetch-repo';
import { runSca, type ScaResult } from './sca';
import { runAuthzMatrix, type AuthzResult } from './authz-matrix';
import type { Finding, CodeFile } from './static-checks';

const MAX_ROUTE_FILES = 400;
const FETCH_CONCURRENCY = 12;

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'grappes-soc2-lab' };
  const token = (import.meta as any).env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function defaultBranch(owner: string, repo: string): Promise<string> {
  const res = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders() });
  if (!res.ok) throw new Error(`repo lookup ${res.status}`);
  return ((await res.json()) as any).default_branch || 'main';
}

async function rawFile(owner: string, repo: string, branch: string, path: string): Promise<string | null> {
  const res = await fetch(`https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`, {
    headers: { 'User-Agent': 'grappes-soc2-lab' },
  });
  return res.ok ? res.text() : null;
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export interface DeepEnginesResult {
  findings: Finding[];
  sca: ScaResult['stats'];
  authz: AuthzResult['stats'];
}

/** Fetch lockfile + API routes for `repoUrl` and run the deep engines. */
export async function runDeepEngines(repoUrl: string): Promise<DeepEnginesResult | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;
  const { owner, repo } = parsed;

  let branch = 'main';
  try { branch = await defaultBranch(owner, repo); } catch { return null; }

  // 1) Lockfile for SCA (try common locations).
  const lockPaths = ['package-lock.json', 'npm-shrinkwrap.json'];
  let scaFiles: CodeFile[] = [];
  for (const p of lockPaths) {
    const content = await rawFile(owner, repo, branch, p);
    if (content) { scaFiles = [{ path: p, content }]; break; }
  }

  // 2) Enumerate the tree and pull every API route file for the authz matrix.
  let routeFiles: CodeFile[] = [];
  try {
    const treeRes = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`, { headers: ghHeaders() });
    if (treeRes.ok) {
      const tree = ((await treeRes.json()) as any).tree as { path: string; type: string }[];
      const routePaths = (tree ?? [])
        .filter((n) => n.type === 'blob' && /(^|\/)(src\/)?pages\/api\/.+\.(ts|js)$/.test(n.path) && !/\.test\./.test(n.path))
        .map((n) => n.path)
        .slice(0, MAX_ROUTE_FILES);
      const contents = await mapLimit(routePaths, FETCH_CONCURRENCY, (p) => rawFile(owner, repo, branch, p));
      routeFiles = routePaths
        .map((p, i) => ({ path: p, content: contents[i] }))
        .filter((f): f is CodeFile => typeof f.content === 'string');
    }
  } catch { /* tree unavailable — authz matrix just runs on whatever we have */ }

  const sca = await runSca(scaFiles.length ? scaFiles : []);
  const authz = runAuthzMatrix(routeFiles);

  return {
    findings: [...sca.findings, ...authz.findings],
    sca: sca.stats,
    authz: authz.stats,
  };
}
