// ── SOC 2 Code Audit — public repo fetcher ─────────────────────────────────
// Bounded fetch of a public GitHub repo: pulls the tree, keeps code/config
// files most relevant to a security review, caps total count and bytes.

import type { CodeFile } from './static-checks';

const MAX_FILES = 40;
const MAX_FILE_BYTES = 200_000;
const MAX_TOTAL_BYTES = 1_500_000;

// Extensions worth reviewing for SOC 2 control gaps
const CODE_EXT = /\.(ts|tsx|js|jsx|mjs|cjs|py|go|rb|php|java|cs|rs|sql|env|yml|yaml|toml|json|sh|tf|dockerfile)$/i;
// Config/security-relevant filenames even without a code extension
const KEY_NAMES = /(dockerfile|\.env|docker-compose|package\.json|requirements\.txt|go\.mod|gemfile|pom\.xml|\.npmrc|nginx\.conf)/i;
// Skip noise
const SKIP = /(node_modules\/|\.git\/|dist\/|build\/|vendor\/|\.next\/|coverage\/|\.lock$|\.min\.(js|css)$|\.map$|package-lock\.json|yarn\.lock|pnpm-lock)/i;

export interface ParsedRepo { owner: string; repo: string; }

export function parseGitHubUrl(input: string): ParsedRepo | null {
  const m = input
    .trim()
    .replace(/\.git$/, '')
    .match(/github\.com[/:]([^/\s]+)\/([^/\s]+)/i);
  if (!m) return null;
  return { owner: m[1], repo: m[2] };
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'grappes-soc2-lab',
  };
  const token = import.meta.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

export async function fetchPublicRepo(input: string): Promise<{ label: string; files: CodeFile[] }> {
  const parsed = parseGitHubUrl(input);
  if (!parsed) throw new Error('Only public GitHub repo URLs are supported (e.g. github.com/owner/repo).');
  const { owner, repo } = parsed;

  // Resolve default branch
  const repoRes = await fetch(`https://api.github.com/repos/${owner}/${repo}`, { headers: ghHeaders() });
  if (repoRes.status === 404) throw new Error('Repo not found or not public.');
  if (repoRes.status === 403) throw new Error('GitHub rate limit hit. Try again shortly or paste the code instead.');
  if (!repoRes.ok) throw new Error(`GitHub error (${repoRes.status}).`);
  const repoJson: any = await repoRes.json();
  const branch = repoJson.default_branch ?? 'main';

  // Pull the full tree
  const treeRes = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`,
    { headers: ghHeaders() },
  );
  if (!treeRes.ok) throw new Error(`Could not read repo tree (${treeRes.status}).`);
  const treeJson: any = await treeRes.json();
  const tree: any[] = Array.isArray(treeJson.tree) ? treeJson.tree : [];

  // Select candidate files
  const candidates = tree
    .filter(n => n.type === 'blob' && typeof n.path === 'string')
    .filter(n => !SKIP.test(n.path))
    .filter(n => CODE_EXT.test(n.path) || KEY_NAMES.test(n.path))
    .filter(n => (n.size ?? 0) <= MAX_FILE_BYTES)
    // prioritise security-relevant paths first
    .sort((a, b) => score(b.path) - score(a.path))
    .slice(0, MAX_FILES);

  const files: CodeFile[] = [];
  let total = 0;
  for (const n of candidates) {
    if (total >= MAX_TOTAL_BYTES) break;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${n.path}`;
    const r = await fetch(rawUrl, { headers: { 'User-Agent': 'grappes-soc2-lab' } });
    if (!r.ok) continue;
    let content = await r.text();
    if (content.length > MAX_FILE_BYTES) content = content.slice(0, MAX_FILE_BYTES);
    total += content.length;
    files.push({ path: n.path, content });
  }

  if (!files.length) throw new Error('No reviewable source files found in that repo.');
  return { label: `${owner}/${repo}`, files };
}

// Rank paths so auth/config/security files are reviewed even if we hit the cap
function score(path: string): number {
  const p = path.toLowerCase();
  let s = 0;
  if (/(auth|login|session|token|password|crypto|secret|security|permission|role|acl)/.test(p)) s += 10;
  if (/(api|route|controller|handler|middleware)/.test(p)) s += 6;
  if (/(\.env|config|docker|nginx|package\.json|requirements)/.test(p)) s += 5;
  if (/(db|database|sql|query|model)/.test(p)) s += 4;
  return s;
}
