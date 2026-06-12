// Fire the SOC 2 SAST worker (GitHub Actions) for a target repo. Best-effort:
// returns false (no throw) when GitHub isn't configured, so a code audit still
// returns its in-function results immediately and the SAST findings land on the
// assessment asynchronously when the run finishes.

import { parseGitHubUrl } from './fetch-repo';
import { e } from '../env';

export async function dispatchSastScan(targetRepoUrl: string, assessmentId: string): Promise<boolean> {
  const owner = e('GITHUB_ORG');
  const token = e('GITHUB_TOKEN');
  const repo = e('GITHUB_GEN_REPO') || 'grappes-app';
  if (!owner || !token) return false;
  const target = parseGitHubUrl(targetRepoUrl);
  if (!target) return false;
  try {
    const res = await fetch(`https://api.github.com/repos/${owner}/${repo}/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/vnd.github+json',
        'content-type': 'application/json',
        'user-agent': 'grappes-soc2',
      },
      body: JSON.stringify({
        event_type: 'soc2-sast',
        client_payload: { target_repo: `${target.owner}/${target.repo}`, assessment_id: assessmentId },
      }),
    });
    return res.ok;
  } catch {
    return false;
  }
}
