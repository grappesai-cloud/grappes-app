// ─── Admin: Fix HTML TypeScript Syntax ───────────────────────────────────────
// One-time utility to strip TypeScript from stored HTML for a given project.
// Requires x-admin-secret header matching ADMIN_SECRET env var.

import type { APIRoute } from 'astro';
import { timingSafeEqual } from 'node:crypto';
import { createAdminClient } from '../../../lib/supabase';
import { stripTypescriptFromHtml } from '../../../lib/strip-ts';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';

export const POST: APIRoute = async ({ request }) => {
  // 10 admin requests/hour per IP
  if (!checkRateLimit(`admin:${getClientIp(request)}`, 10, 3_600_000)) {
    return new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 });
  }

  const secret      = request.headers.get('x-admin-secret') ?? '';
  const adminSecret = import.meta.env.ADMIN_SECRET ?? '';
  const allowed = adminSecret !== '' && (() => {
    try { return timingSafeEqual(Buffer.from(secret), Buffer.from(adminSecret)); } catch { return false; }
  })();
  if (!allowed) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body: { projectId?: string };
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const { projectId } = body;
  if (!projectId) {
    return new Response(JSON.stringify({ error: 'projectId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const supabase = createAdminClient();

  // Fetch the latest generated files for this project
  const { data, error } = await supabase
    .from('generated_files')
    .select('id, files')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(1)
    .single();

  if (error || !data) {
    if (error) console.error('[admin/fix-html] Lookup error:', error);
    return new Response(JSON.stringify({ error: 'No generated files found' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const files: Record<string, string> = data.files ?? {};
  const updatedFiles: Record<string, string> = {};
  let fixedCount = 0;

  for (const [key, value] of Object.entries(files)) {
    if (typeof value === 'string' && value.includes('<script')) {
      const fixed = stripTypescriptFromHtml(value);
      updatedFiles[key] = fixed;
      if (fixed !== value) fixedCount++;
    } else {
      updatedFiles[key] = value;
    }
  }

  const { error: updateError } = await supabase
    .from('generated_files')
    .update({ files: updatedFiles })
    .eq('id', data.id);

  if (updateError) {
    console.error('[admin/fix-html] Update error:', updateError);
    return new Response(JSON.stringify({ error: 'Failed to update' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({ ok: true, projectId, rowId: data.id, fixedCount }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
};
