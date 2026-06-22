// ── Tool catalog: single source of truth for the 8 Grappes tools ─────────────
// Keys line up 1:1 with CreditKind (credits.ts), so per-tool QUOTA = credits and
// per-tool ACCESS = the `allowed_tools` allowlist on public.users.
//
// allowed_tools semantics:
//   • NULL  → full access (legacy users + anyone not provisioned by the admin).
//   • []    → no tools.
//   • [...] → explicit allowlist.

import type { CreditKind } from './credits';
import { createAdminClient } from './supabase';

export interface ToolDef {
  key: CreditKind;
  label: string;
  /** Page route prefix (the tool's UI). */
  pagePrefix: string;
  /** API route prefix, gated alongside the page when tool-specific. */
  apiPrefix?: string;
  /** Accent for the admin toggles, mirrors the dashboard tiles. */
  accent: string;
}

export const TOOLS: ToolDef[] = [
  { key: 'site',      label: 'Sites',          pagePrefix: '/dashboard/sites',  accent: '#06bfdd' },
  { key: 'reel',      label: 'Reels Lab',      pagePrefix: '/reels',     apiPrefix: '/api/reels',     accent: '#a78bfa' },
  { key: 'social',    label: 'Social Lab',     pagePrefix: '/social',    apiPrefix: '/api/social',    accent: '#f472b6' },
  { key: 'audit',     label: 'Audit Lab',      pagePrefix: '/audit',     apiPrefix: '/api/audit',     accent: '#22d3ee' },
  { key: 'soc2',      label: 'SOC 2 Lab',      pagePrefix: '/soc2',      apiPrefix: '/api/soc2',      accent: '#34d399' },
  { key: 'brandbook', label: 'Brand Book Lab', pagePrefix: '/brandbook', apiPrefix: '/api/brandbook', accent: '#f97316' },
  { key: 'logo',      label: 'Logo Lab',       pagePrefix: '/logo',      apiPrefix: '/api/logo',      accent: '#a78bfa' },
  { key: 'offer',     label: 'Offer Lab',      pagePrefix: '/dashboard/offers', accent: '#06bfdd' },
];

export const TOOL_KEYS: CreditKind[] = TOOLS.map((t) => t.key);

export function isToolKey(k: string): k is CreditKind {
  return (TOOL_KEYS as string[]).includes(k);
}

/** Keep only valid tool keys, de-duplicated. */
export function sanitizeTools(input: unknown): CreditKind[] {
  if (!Array.isArray(input)) return [];
  const out: CreditKind[] = [];
  for (const v of input) {
    if (typeof v === 'string' && isToolKey(v) && !out.includes(v)) out.push(v);
  }
  return out;
}

/** Whether a user with `allowed` (the raw column value) may use `key`. */
export function toolAllowed(allowed: string[] | null | undefined, key: CreditKind): boolean {
  if (allowed == null) return true; // NULL = full access
  return allowed.includes(key);
}

/** Map a request path to the tool it belongs to (page or API prefix), or null. */
export function toolForPath(path: string): CreditKind | null {
  for (const t of TOOLS) {
    if (path === t.pagePrefix || path.startsWith(t.pagePrefix + '/')) return t.key;
    if (t.apiPrefix && (path === t.apiPrefix || path.startsWith(t.apiPrefix + '/'))) return t.key;
  }
  return null;
}

/**
 * Read a user's tool allowlist. Returns the array, or NULL for full access
 * (legacy users, or any environment where the column isn't there yet). Never
 * throws — a DB hiccup must not lock anyone out of their tools.
 */
export async function getAllowedTools(userId: string): Promise<string[] | null> {
  try {
    const { data } = await createAdminClient()
      .from('users').select('allowed_tools').eq('id', userId).maybeSingle();
    const v = (data as { allowed_tools?: unknown } | null)?.allowed_tools;
    return Array.isArray(v) ? (v as string[]) : null;
  } catch {
    return null;
  }
}
