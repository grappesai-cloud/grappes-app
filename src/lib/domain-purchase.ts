/**
 * Vercel domain purchase + project attachment.
 * Called from the Stripe webhook after payment is confirmed.
 */

import { createAdminClient } from './supabase';
import { e } from './env';

const BASE = 'https://api.vercel.com';

function vercelHeaders() {
  return {
    Authorization: `Bearer ${e('VERCEL_TOKEN')}`,
    'Content-Type': 'application/json',
  };
}

function qs() {
  const teamId = e('VERCEL_TEAM_ID');
  return teamId ? `?teamId=${teamId}` : '';
}

/**
 * Purchases a domain through Vercel and attaches it to the given project.
 * On success, sets custom_domain + domain_verified=true in DB.
 * Returns null on success, error string on failure.
 */
export async function purchaseDomainAndAttach(
  projectId: string,
  vercelProjectId: string | null | undefined,
  domainName: string,
  expectedPriceUsd: number,
): Promise<string | null> {
  const token = import.meta.env.VERCEL_TOKEN;
  if (!token) return 'VERCEL_TOKEN not configured.';

  // ── 1. Purchase domain ─────────────────────────────────────────────────────
  const buyRes = await fetch(`${BASE}/v4/domains/buy${qs()}`, {
    method: 'POST',
    headers: vercelHeaders(),
    body: JSON.stringify({ name: domainName, expectedPrice: expectedPriceUsd || undefined }),
  });

  if (!buyRes.ok) {
    const err = await buyRes.json().catch(() => ({}));
    const code = err?.error?.code;
    // already owned — not a real error
    if (code !== 'domain_already_purchased') {
      return err?.error?.message ?? `Vercel buy error ${buyRes.status}`;
    }
  }

  // ── 2. Attach to project ───────────────────────────────────────────────────
  let attachSuccess = !vercelProjectId; // if no project, skip = "success"
  if (vercelProjectId) {
    const attachRes = await fetch(
      `${BASE}/v9/projects/${encodeURIComponent(vercelProjectId)}/domains${qs()}`,
      {
        method: 'POST',
        headers: vercelHeaders(),
        body: JSON.stringify({ name: domainName }),
      }
    );
    if (attachRes.ok) {
      attachSuccess = true;
    } else {
      const e = await attachRes.json().catch(() => ({}));
      if (e?.error?.code === 'domain_already_added') {
        attachSuccess = true;
      } else {
        console.warn('[domain-purchase] Attach warning:', e?.error?.message);
        // Non-fatal — domain purchased, attachment can be retried manually
      }
    }
  }

  // ── 3. Save to DB — only set domain_verified if attach succeeded ──────────
  const supabase = createAdminClient();
  await supabase
    .from('projects')
    .update({
      custom_domain:   domainName,
      domain_verified: attachSuccess,
      updated_at:      new Date().toISOString(),
    })
    .eq('id', projectId);

  return null; // success
}

/**
 * Platform charge for a domain: Vercel USD price + markup (env DOMAIN_MARKUP_EUR, default 5).
 * We treat 1 USD ≈ 1 EUR for simplicity (close enough, and slightly profitable).
 */
export function getDomainChargeEur(vercelPriceUsd: number): number {
  const markup = Number(e('DOMAIN_MARKUP_EUR') || 5);
  return Math.ceil(vercelPriceUsd) + markup;
}

/**
 * Fetches the actual domain price from Vercel API.
 * Returns the price in USD, or null if unavailable.
 */
export async function getVercelDomainPrice(domainName: string): Promise<number | null> {
  const token = import.meta.env.VERCEL_TOKEN;
  if (!token) return null;
  const teamId = import.meta.env.VERCEL_TEAM_ID;
  const url = `${BASE}/v4/domains/price?name=${encodeURIComponent(domainName)}${teamId ? `&teamId=${encodeURIComponent(teamId)}` : ''}`;
  try {
    const res = await fetch(url, { headers: vercelHeaders() });
    if (!res.ok) return null;
    const data = await res.json();
    return typeof data.price === 'number' ? data.price : null;
  } catch {
    return null;
  }
}
