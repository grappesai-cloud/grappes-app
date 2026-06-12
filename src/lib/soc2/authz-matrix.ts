// ── SOC 2 gray-box authorization matrix ────────────────────────────────────
// Code-informed authz analysis. A blind external pentest is blocked by the WAF
// and can't see authz logic anyway; but we have the source, so we build a matrix
// of every API route x HTTP method and classify how each is protected. Flags the
// real, high-value issues a SOC 2 audit cares about under CC6.1/CC6.3: mutating
// endpoints with no auth, and object-by-id handlers with no ownership check
// (IDOR / broken object-level authorization).

import type { Finding, Severity } from './static-checks';
import type { CodeFile } from './static-checks';

type Method = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
type AuthKind = 'user' | 'admin' | 'cron' | 'signature' | 'public' | 'webhook';

interface RouteEntry {
  path: string;          // route path (api/...)
  method: Method;
  auth: AuthKind;
  dynamicId: boolean;    // path has a [param]
  ownershipCheck: boolean;
}

const METHOD_RE = /export\s+const\s+(GET|POST|PUT|PATCH|DELETE)\s*[:=]/g;
const MUTATING: Method[] = ['POST', 'PUT', 'PATCH', 'DELETE'];

function isApiRoute(path: string): boolean {
  return /(^|\/)(src\/)?pages\/api\/.+\.(ts|js)$/.test(path) && !/\.test\./.test(path);
}

function routeLabel(path: string): string {
  const m = path.match(/pages\/(api\/.+)\.(ts|js)$/);
  return m ? '/' + m[1].replace(/\/index$/, '') : path;
}

/** Classify how the handler authenticates the caller. */
function classifyAuth(body: string): AuthKind {
  if (/CRON_SECRET|x-cron|Bearer\s*\$\{?cronSecret|authorization.*[Bb]earer/.test(body) && /CRON_SECRET|cronSecret/.test(body)) return 'cron';
  if (/verifyAdminSession|admin_session|requireAdmin|isAdmin\b/.test(body)) return 'admin';
  if (/verifyWebhookSignature|stripe\.webhooks\.constructEvent|svix|verifySignature|hmac|timingSafeEqual/.test(body)) return 'signature';
  if (/locals\.user|getSession|requireUser|auth\.api\.getSession|ctx\.user\b/.test(body)) return 'user';
  if (/webhook/i.test(body)) return 'webhook';
  return 'public';
}

/** Heuristic: does the handler compare a fetched object's owner to the caller? */
function hasOwnershipCheck(body: string): boolean {
  return /user_id\s*[!=]==?\s*user\.id|\.user_id\s*!==\s*|project\.user_id|\.eq\(\s*['"]user_id['"]\s*,\s*user\.id|where[^)]*user_id|belongsTo|assertOwner|ownerId\s*[!=]==/.test(body);
}

export interface AuthzResult {
  findings: Finding[];
  matrix: RouteEntry[];
  stats: { routes: number; methods: number; publicMutating: number; idorRisk: number };
}

export function runAuthzMatrix(files: CodeFile[]): AuthzResult {
  const matrix: RouteEntry[] = [];
  const findings: Finding[] = [];

  for (const f of files) {
    if (!isApiRoute(f.path)) continue;
    const label = routeLabel(f.path);
    const dynamicId = /\[[^\]]+\]/.test(f.path);
    const auth = classifyAuth(f.content);
    const ownershipCheck = hasOwnershipCheck(f.content);

    METHOD_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    const methods = new Set<Method>();
    while ((m = METHOD_RE.exec(f.content))) methods.add(m[1] as Method);
    if (methods.size === 0) continue;

    for (const method of methods) {
      matrix.push({ path: label, method, auth, dynamicId, ownershipCheck });

      // 1) Mutating endpoint with no auth at all → broken access control.
      if (MUTATING.includes(method) && auth === 'public') {
        // webhooks legitimately authenticate by signature, not session — only
        // flag if there's truly no signature/secret verification anywhere.
        findings.push({
          id: `authz-public-${label.replace(/[^a-z0-9]/gi, '-')}-${method}`,
          title: `Unauthenticated ${method} ${label}`,
          severity: 'high',
          criterion: 'security',
          control: 'CC6.1',
          source: 'authz',
          detail: `The ${method} handler for ${label} has no detectable authentication (no session, admin, cron-secret, or signature check). A state-changing endpoint reachable without auth is a broken-access-control gap.`,
          fix: `Require an authenticated caller (check \`locals.user\`), verify an admin session, validate a webhook signature, or gate on a shared secret — whichever matches the endpoint's intent.`,
          evidence: `${f.path} → export ${method}`,
        });
      }

      // 2) Object-by-id handler, user-authed but no ownership comparison → IDOR.
      if (dynamicId && auth === 'user' && !ownershipCheck && method !== 'GET') {
        findings.push({
          id: `authz-idor-${label.replace(/[^a-z0-9]/gi, '-')}-${method}`,
          title: `Possible IDOR: ${method} ${label} authenticates but may not check object ownership`,
          severity: 'medium',
          criterion: 'security',
          control: 'CC6.3',
          source: 'authz',
          detail: `${method} ${label} acts on a resource identified in the URL and requires a logged-in user, but no object-ownership comparison (e.g. \`resource.user_id === user.id\`) was detected. If the handler trusts the URL id without verifying the caller owns it, any user can act on any object (broken object-level authorization).`,
          fix: `After loading the object, verify it belongs to the caller (e.g. \`if (row.user_id !== user.id) return 404\`) before reading or mutating it.`,
          evidence: `${f.path} → export ${method}`,
        });
      }
    }
  }

  const publicMutating = findings.filter((f) => f.id.startsWith('authz-public-')).length;
  const idorRisk = findings.filter((f) => f.id.startsWith('authz-idor-')).length;
  return { findings, matrix, stats: { routes: new Set(matrix.map((r) => r.path)).size, methods: matrix.length, publicMutating, idorRisk } };
}
