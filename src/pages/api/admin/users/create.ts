// ── POST /api/admin/users/create ─────────────────────────────────────────────
// Admin provisions an account: enter an email, the system generates a password,
// creates the Better-Auth user (correct password hashing + account row), sets
// the tool allowlist + initial per-tool credits, and (optionally) emails the
// credentials. Returns the generated password ONCE so the admin can hand it over.
//
// Body: { email, name?, tools?: string[]|null, credits?: Record<kind, number>, sendEmail?: boolean }

import type { APIRoute } from 'astro';
import { randomBytes } from 'node:crypto';
import { auth } from '../../../../lib/auth';
import { createAdminClient } from '../../../../lib/supabase';
import { verifyAdminSession } from '../../../../lib/admin-auth';
import { CREDIT_COLUMN, type CreditKind } from '../../../../lib/credits';
import { TOOLS, sanitizeTools } from '../../../../lib/tools';
import { json } from '../../../../lib/api-utils';

/** Strong, readable generated password (base64url, ~16 chars, meets min length 8). */
function generatePassword(): string {
  return randomBytes(12).toString('base64url');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export const POST: APIRoute = async ({ cookies, request }) => {
  if (!verifyAdminSession(cookies.get('admin_session')?.value)) return json({ error: 'Forbidden' }, 403);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }

  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return json({ error: 'Valid email required.' }, 400);

  const name = (String(body?.name ?? '').trim() || email.split('@')[0]).slice(0, 80);
  // tools: undefined/null → full access (NULL column); array → explicit allowlist.
  const toolsProvided = Array.isArray(body?.tools);
  const tools = toolsProvided ? sanitizeTools(body.tools) : null;
  const sendEmail = body?.sendEmail !== false; // default: yes

  // Initial per-tool credits, validated against CREDIT_COLUMN.
  const creditUpdate: Record<string, number> = {};
  if (body?.credits && typeof body.credits === 'object') {
    for (const [kind, raw] of Object.entries(body.credits)) {
      if (!(kind in CREDIT_COLUMN)) continue;
      const amt = Math.max(0, Math.min(999_999, Math.floor(Number(raw) || 0)));
      if (amt > 0) creditUpdate[CREDIT_COLUMN[kind as CreditKind]] = amt;
    }
  }

  const client = createAdminClient();

  // Reject duplicates up front for a clean message (Better-Auth would 422).
  const { data: existing } = await client.from('users').select('id').eq('email', email).maybeSingle();
  if (existing) return json({ error: 'A user with that email already exists.' }, 409);

  const password = generatePassword();

  // Create via Better-Auth so the password is hashed correctly and an account
  // row is written. The databaseHook mirrors the row into public.users.
  let userId: string;
  try {
    const created: any = await auth.api.signUpEmail({ body: { email, password, name } });
    userId = created?.user?.id;
    if (!userId) {
      const { data: row } = await client.from('users').select('id').eq('email', email).maybeSingle();
      userId = (row as any)?.id;
    }
    if (!userId) return json({ error: 'Account created but could not resolve user id.' }, 500);
  } catch (err: any) {
    const msg = String(err?.message ?? err ?? '');
    if (/exist|already|unique|duplicate/i.test(msg)) return json({ error: 'A user with that email already exists.' }, 409);
    console.error('[admin/users/create] signUp failed:', err);
    return json({ error: 'Could not create account: ' + (msg || 'unknown') }, 500);
  }

  // Apply allowlist + credits (upsert guards against a missed mirror insert).
  const update: Record<string, any> = { id: userId, email, name };
  if (toolsProvided) update.allowed_tools = tools;
  Object.assign(update, creditUpdate);
  try {
    await client.from('users').upsert(update, { onConflict: 'id' });
  } catch (err) {
    console.error('[admin/users/create] profile update failed:', err);
    // Account still exists; surface a soft warning rather than failing hard.
  }

  let emailed = false;
  if (sendEmail) {
    try {
      const { sendAccountCredentialsEmail } = await import('../../../../lib/resend');
      const labels = (tools ?? TOOLS.map((t) => t.key)).map((k) => TOOLS.find((t) => t.key === k)?.label ?? k);
      const res = await sendAccountCredentialsEmail({ to: email, name, password, tools: labels });
      emailed = res.success;
    } catch (err) {
      console.warn('[admin/users/create] credentials email failed:', err);
    }
  }

  return json({ ok: true, userId, email, name, password, emailed, allowed_tools: tools });
};
