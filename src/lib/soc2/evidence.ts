// ── SOC 2 control evidence from the GitHub API ─────────────────────────────
// Instead of inferring controls from prose, pull real configuration evidence:
// change-management (branch protection, required reviews), access control (org
// 2FA), and vulnerability management (Dependabot, secret scanning, security
// advisories). Each maps to a SOC 2 Common Criteria control. Where the token
// lacks permission (e.g. org 2FA on a repo it doesn't admin), the item is marked
// "unknown" rather than guessed.

import { parseGitHubUrl } from './fetch-repo';
import type { Finding } from './static-checks';

export interface EvidenceItem {
  control: string;                         // e.g. "CC8.1"
  title: string;
  status: 'present' | 'absent' | 'unknown';
  detail: string;
}

export interface EvidenceResult {
  items: EvidenceItem[];
  findings: Finding[];
}

function ghHeaders(): Record<string, string> {
  const h: Record<string, string> = { Accept: 'application/vnd.github+json', 'User-Agent': 'grappes-soc2-lab' };
  const token = (import.meta as any).env?.GITHUB_TOKEN ?? process.env.GITHUB_TOKEN;
  if (token) h.Authorization = `Bearer ${token}`;
  return h;
}

async function gh(path: string): Promise<{ ok: boolean; status: number; json: any }> {
  try {
    const res = await fetch(`https://api.github.com${path}`, { headers: ghHeaders() });
    let json: any = null;
    try { json = await res.json(); } catch { /* 204 / empty */ }
    return { ok: res.ok, status: res.status, json };
  } catch {
    return { ok: false, status: 0, json: null };
  }
}

export async function collectGithubEvidence(repoUrl: string): Promise<EvidenceResult | null> {
  const parsed = parseGitHubUrl(repoUrl);
  if (!parsed) return null;
  const { owner, repo } = parsed;

  const items: EvidenceItem[] = [];
  const findings: Finding[] = [];

  const add = (e: EvidenceItem) => items.push(e);
  const gap = (f: Omit<Finding, 'source'>) => findings.push({ ...f, source: 'evidence' });

  // ── Repo metadata + security_and_analysis (Dependabot / secret scanning) ──
  const repoRes = await gh(`/repos/${owner}/${repo}`);
  if (!repoRes.ok) {
    return { items: [{ control: 'CC1.1', title: 'Repository access', status: 'unknown', detail: `Could not read repo metadata (HTTP ${repoRes.status}).` }], findings: [] };
  }
  const meta = repoRes.json;
  const branch: string = meta.default_branch || 'main';
  const sec = meta.security_and_analysis ?? {};

  const secretScanning = sec.secret_scanning?.status ?? (meta.private ? 'unknown' : 'disabled');
  add({ control: 'CC7.1', title: 'Secret scanning', status: secretScanning === 'enabled' ? 'present' : (secretScanning === 'unknown' ? 'unknown' : 'absent'), detail: `GitHub secret scanning: ${secretScanning}.` });
  if (secretScanning === 'disabled') gap({ id: 'evidence-no-secret-scanning', title: 'GitHub secret scanning is disabled', severity: 'medium', criterion: 'security', control: 'CC7.1', detail: 'Secrets accidentally committed will not be detected automatically. SOC 2 vulnerability management expects detection of exposed credentials.', fix: 'Enable Secret Scanning (and Push Protection) in the repo/org Security settings.' });

  const pushProtection = sec.secret_scanning_push_protection?.status;
  if (pushProtection) add({ control: 'CC7.1', title: 'Secret push protection', status: pushProtection === 'enabled' ? 'present' : 'absent', detail: `Push protection: ${pushProtection}.` });

  // ── Dependabot / vulnerability alerts ──
  const vulnAlerts = await gh(`/repos/${owner}/${repo}/vulnerability-alerts`); // 204 = enabled, 404 = disabled
  const alertsOn = vulnAlerts.status === 204;
  add({ control: 'CC7.1', title: 'Dependabot / vulnerability alerts', status: vulnAlerts.status === 204 ? 'present' : (vulnAlerts.status === 404 ? 'absent' : 'unknown'), detail: alertsOn ? 'Dependency vulnerability alerts are enabled.' : 'Dependency vulnerability alerts are not enabled (or not visible).' });
  if (vulnAlerts.status === 404) gap({ id: 'evidence-no-dependabot', title: 'Dependabot vulnerability alerts are disabled', severity: 'medium', criterion: 'security', control: 'CC7.1', detail: 'Known-vulnerable dependencies will not raise alerts. Continuous dependency monitoring is a core SOC 2 vulnerability-management control.', fix: 'Enable Dependabot alerts (and security updates) in repo Settings → Code security.' });

  // ── Branch protection on the default branch (change management) ──
  const prot = await gh(`/repos/${owner}/${repo}/branches/${branch}/protection`);
  if (prot.ok) {
    const reviews = prot.json?.required_pull_request_reviews;
    const checks = prot.json?.required_status_checks;
    add({ control: 'CC8.1', title: `Branch protection on ${branch}`, status: 'present', detail: `Protected. Required reviews: ${reviews?.required_approving_review_count ?? 0}; status checks: ${checks ? 'yes' : 'no'}; enforce admins: ${prot.json?.enforce_admins?.enabled ? 'yes' : 'no'}.` });
    if (!reviews || (reviews.required_approving_review_count ?? 0) < 1) {
      gap({ id: 'evidence-no-required-reviews', title: `No required PR reviews on ${branch}`, severity: 'medium', criterion: 'integrity', control: 'CC8.1', detail: 'Changes can merge to the production branch without peer review. SOC 2 change management (CC8.1) expects reviewed, approved changes.', fix: `Require at least 1 approving review in branch protection for ${branch}.` });
    }
  } else if (prot.status === 404) {
    add({ control: 'CC8.1', title: `Branch protection on ${branch}`, status: 'absent', detail: 'The default branch has no protection rule.' });
    gap({ id: 'evidence-no-branch-protection', title: `Default branch (${branch}) is not protected`, severity: 'high', criterion: 'integrity', control: 'CC8.1', detail: 'Anyone with write access can push directly to production with no review or required checks. This is a primary SOC 2 change-management gap (CC8.1).', fix: `Add a branch protection rule on ${branch}: require pull requests, ≥1 approval, status checks, and dismiss stale approvals.` });
  } else {
    add({ control: 'CC8.1', title: `Branch protection on ${branch}`, status: 'unknown', detail: `Could not read protection (HTTP ${prot.status}); token may lack admin scope.` });
  }

  // ── Org 2FA requirement (access control) ──
  if (meta.owner?.type === 'Organization') {
    const org = await gh(`/orgs/${owner}`);
    const tfa = org.json?.two_factor_requirement_enabled;
    if (org.ok && typeof tfa === 'boolean') {
      add({ control: 'CC6.1', title: 'Org-wide 2FA requirement', status: tfa ? 'present' : 'absent', detail: tfa ? 'The GitHub org requires 2FA for all members.' : 'The GitHub org does not require 2FA.' });
      if (!tfa) gap({ id: 'evidence-no-org-2fa', title: 'GitHub org does not enforce 2FA', severity: 'high', criterion: 'security', control: 'CC6.1', detail: 'Members can access source code and CI without two-factor authentication. SOC 2 access control (CC6.1) expects enforced MFA on systems holding sensitive data.', fix: 'Enable "Require two-factor authentication" in the GitHub organization security settings.' });
    } else {
      add({ control: 'CC6.1', title: 'Org-wide 2FA requirement', status: 'unknown', detail: 'Token lacks org-admin scope to read the 2FA requirement.' });
    }
  }

  return { items, findings };
}
