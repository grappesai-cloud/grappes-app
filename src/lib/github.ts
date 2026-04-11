import { e } from './env';

const BASE = 'https://api.github.com';

function headers() {
  return {
    Authorization: `Bearer ${e('GITHUB_TOKEN')}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function gh(path: string, init: RequestInit = {}) {
  const res = await fetch(`${BASE}${path}`, { ...init, headers: headers() });
  return res;
}

// ─── Repo ─────────────────────────────────────────────────────────────────────

export async function createOrGetRepo(
  name: string,
  description = ''
): Promise<{ fullName: string; htmlUrl: string }> {
  const owner = e('GITHUB_ORG');

  // Check for existing repo
  const existing = await gh(`/repos/${owner}/${name}`);
  if (existing.ok) {
    const d = await existing.json();
    return { fullName: d.full_name, htmlUrl: d.html_url };
  }

  // Create under org (or fall back to user account if GITHUB_ORG is a personal account)
  // auto_init: true adds an initial commit so the Git Data API (blobs/trees) works immediately
  const repoBody = JSON.stringify({ name, description, private: true, auto_init: true });
  let res = await gh(`/orgs/${owner}/repos`, { method: 'POST', body: repoBody });
  if (!res.ok && res.status === 404) {
    // Not an org — fall back to user account
    res = await gh('/user/repos', { method: 'POST', body: repoBody });
  }

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(`GitHub repo creation failed: ${(err as any).message ?? res.status}`);
  }

  const d = await res.json();
  return { fullName: d.full_name, htmlUrl: d.html_url };
}

// ─── Push all files via Git Tree API (single commit) ─────────────────────────

export async function pushFiles(
  fullName: string,
  files: Record<string, string>,
  message = 'Deploy via WebAI'
): Promise<{ commitSha: string; commitUrl: string }> {
  // 1. Find HEAD of main (may not exist for empty repo)
  let parentSha: string | undefined;
  let baseTreeSha: string | undefined;

  const refRes = await gh(`/repos/${fullName}/git/refs/heads/main`);
  if (refRes.ok) {
    const refData = await refRes.json();
    parentSha = refData.object?.sha as string;

    if (parentSha) {
      const commitRes = await gh(`/repos/${fullName}/git/commits/${parentSha}`);
      if (commitRes.ok) {
        const commitData = await commitRes.json();
        baseTreeSha = commitData.tree?.sha as string;
      }
    }
  }

  // 2. Create a blob for every file (sequential to avoid 409 on new repos)
  const treeItems: { path: string; mode: string; type: string; sha: string }[] = [];
  for (const [path, content] of Object.entries(files)) {
    let blobSha: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      const blobRes = await gh(`/repos/${fullName}/git/blobs`, {
        method: 'POST',
        body: JSON.stringify({
          content: Buffer.from(content, 'utf-8').toString('base64'),
          encoding: 'base64',
        }),
      });
      if (blobRes.ok) {
        const blobData = await blobRes.json();
        blobSha = blobData.sha as string;
        break;
      }
      if (blobRes.status === 409 && attempt < 2) {
        await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }
      throw new Error(`Blob creation failed for ${path}: ${blobRes.status}`);
    }
    treeItems.push({ path, mode: '100644', type: 'blob', sha: blobSha! });
  }

  // 3. Create tree
  const treeBody: Record<string, unknown> = { tree: treeItems };
  if (baseTreeSha) treeBody.base_tree = baseTreeSha;

  const treeRes = await gh(`/repos/${fullName}/git/trees`, {
    method: 'POST',
    body: JSON.stringify(treeBody),
  });
  if (!treeRes.ok) {
    throw new Error(`Tree creation failed: ${treeRes.status}`);
  }
  const treeData = await treeRes.json();

  // 4. Create commit
  const commitBody: Record<string, unknown> = { message, tree: treeData.sha };
  if (parentSha) commitBody.parents = [parentSha];

  const commitRes = await gh(`/repos/${fullName}/git/commits`, {
    method: 'POST',
    body: JSON.stringify(commitBody),
  });
  if (!commitRes.ok) {
    throw new Error(`Commit creation failed: ${commitRes.status}`);
  }
  const commitData = await commitRes.json();

  // 5. Update or create the main branch ref
  if (parentSha) {
    await gh(`/repos/${fullName}/git/refs/heads/main`, {
      method: 'PATCH',
      body: JSON.stringify({ sha: commitData.sha, force: true }),
    });
  } else {
    await gh(`/repos/${fullName}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({ ref: 'refs/heads/main', sha: commitData.sha }),
    });
  }

  return { commitSha: commitData.sha, commitUrl: commitData.html_url ?? '' };
}
