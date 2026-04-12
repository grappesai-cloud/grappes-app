/**
 * Environment variable helper.
 * - import.meta.env: works for PUBLIC_* vars and for private vars inlined by Vite in dev
 * - process.env: fallback for private vars in Vercel SSR runtime (dynamic access bypasses Vite inlining)
 */
export function e(key: string): string {
  return (import.meta as any).env?.[key]
    || (typeof process !== 'undefined' ? process.env[key] : undefined)
    || '';
}

/** Which subsystem each variable powers — used for friendly boot warnings. */
const ENV_SPEC: Record<string, { group: string; required: boolean }> = {
  // Supabase — required for auth, DB, dashboard
  PUBLIC_SUPABASE_URL:       { group: 'Supabase',  required: true },
  PUBLIC_SUPABASE_ANON_KEY:  { group: 'Supabase',  required: true },
  SUPABASE_SERVICE_ROLE_KEY: { group: 'Supabase',  required: true },
  // Anthropic — required for generation
  ANTHROPIC_API_KEY:         { group: 'Anthropic', required: true },
  // Vercel — required for deploy flow
  VERCEL_TOKEN:              { group: 'Vercel',    required: true },
  VERCEL_TEAM_ID:            { group: 'Vercel',    required: true },
  // GitHub — required for repo creation
  GITHUB_TOKEN:              { group: 'GitHub',    required: true },
  GITHUB_ORG:                { group: 'GitHub',    required: true },
  // Resend — required for transactional email
  RESEND_API_KEY:            { group: 'Resend',    required: true },
  // Stripe — optional until real payments
  STRIPE_SECRET_KEY:         { group: 'Stripe',    required: false },
  STRIPE_WEBHOOK_SECRET:     { group: 'Stripe',    required: false },
  // Sentry — optional, error tracking
  SENTRY_DSN:                { group: 'Sentry',    required: false },
};

/**
 * Log warnings for missing env vars without throwing. Call once on app boot.
 * Returns the list of missing critical vars (useful for tests / diagnostics).
 */
export function validateEnv(): { missing: string[]; missingOptional: string[] } {
  const missing: string[] = [];
  const missingOptional: string[] = [];

  for (const [key, spec] of Object.entries(ENV_SPEC)) {
    const val = e(key);
    const isPlaceholder = val.includes('placeholder') || val.startsWith('your-') || val === '';
    if (isPlaceholder) {
      (spec.required ? missing : missingOptional).push(key);
    }
  }

  if (missing.length > 0) {
    const groups = new Set(missing.map((k) => ENV_SPEC[k].group));
    // eslint-disable-next-line no-console
    console.warn(
      `\n⚠️  Grappes env: ${missing.length} critical var(s) missing or placeholder.\n` +
      `   Subsystems affected: ${[...groups].join(', ')}\n` +
      `   Missing: ${missing.join(', ')}\n` +
      `   See SETUP-GRAPPES.md to wire them up.\n`
    );
  }
  if (missingOptional.length > 0) {
    // eslint-disable-next-line no-console
    console.info(
      `ℹ️  Grappes env: ${missingOptional.length} optional var(s) not set (${missingOptional.join(', ')}).`
    );
  }

  return { missing, missingOptional };
}
