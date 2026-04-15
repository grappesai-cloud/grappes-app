// ─── Public Form Submission Endpoint ─────────────────────────────────────────
// Called by contact forms on generated/deployed websites.
// Receives form data, sends email to site owner via Resend.
// No auth required — public endpoint accessed by site visitors.

import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { createAdminClient } from '../../../lib/supabase';
import { sendFormEmail } from '../../../lib/resend';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';

const FREE_FORWARD_LIMIT = 50; // forwarded emails per project per calendar month for free-tier owners

const corsHeaders = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonCors(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders },
  });
}

export const OPTIONS: APIRoute = async () => new Response(null, { status: 204, headers: corsHeaders });

export const POST: APIRoute = async ({ params, request }) => {
  const projectId = params.projectId;
  if (!projectId) return jsonCors({ error: 'Missing project ID' }, 400);

  const ip = getClientIp(request);

  // Per-IP per-project: 5/hour (catches abusive single visitor)
  if (!checkRateLimit(`form:p:${projectId}:${ip}`, 5, 3_600_000)) {
    return jsonCors({ error: 'Too many submissions. Please try again later.' }, 429);
  }
  // Per-IP global: 20/hour across all projects (stops scrapers)
  if (!checkRateLimit(`form:ip:${ip}`, 20, 3_600_000)) {
    return jsonCors({ error: 'Too many submissions. Please try again later.' }, 429);
  }

  try {
    // Accept JSON or form-encoded body
    let body: Record<string, any> = {};
    const ct = request.headers.get('content-type') || '';
    if (ct.includes('application/json')) {
      body = await request.json().catch(() => ({}));
    } else {
      const fd = await request.formData().catch(() => null);
      if (fd) fd.forEach((v, k) => { body[k] = typeof v === 'string' ? v : ''; });
    }

    // Honeypot — bots fill every field. _hp / honeypot must stay empty.
    if ((body._hp ?? body.honeypot ?? '').toString().trim() !== '') {
      return jsonCors({ success: true, message: 'Message sent!' });
    }

    // Type classifier (contact | newsletter | booking | other)
    const typeRaw = (body.type ?? body._type ?? '').toString().toLowerCase();
    const type = ['contact', 'newsletter', 'booking', 'other'].includes(typeRaw) ? typeRaw : 'contact';

    const { name, email, phone, message, subject, ...extra } = body;
    // Cap extra fields
    const cappedExtra: Record<string, string> = {};
    let extraCount = 0;
    for (const [k, v] of Object.entries(extra)) {
      if (k.startsWith('_') || k === 'honeypot' || k === 'type') continue;
      if (extraCount >= 10) break;
      if (typeof v === 'string') { cappedExtra[k] = v.slice(0, 5000); extraCount++; }
    }
    const allFields: Record<string, string | undefined> = { name, email, phone, message, subject, ...cappedExtra };

    // Strip empties
    for (const k of Object.keys(allFields)) {
      const v = allFields[k];
      if (typeof v !== 'string' || !v.trim()) delete allFields[k];
      else if (v.length > 5000) allFields[k] = v.slice(0, 5000);
    }
    if (Object.keys(allFields).length === 0) return jsonCors({ error: 'Empty submission' }, 400);

    // Newsletter only needs an email; contact/booking need a message
    const emailVal = (allFields.email || '').trim();
    const messageVal = (allFields.message || '').trim();
    if (type === 'newsletter') {
      if (!emailVal || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailVal)) {
        return jsonCors({ error: 'Valid email required' }, 400);
      }
    } else {
      if (!messageVal) return jsonCors({ error: 'Message required' }, 400);
    }

    const project = await db.projects.findById(projectId);
    if (!project) return jsonCors({ error: 'Site not found' }, 404);

    const brief = await db.briefs.findByProjectId(projectId);
    const locale = brief?.data?.business?.locale ?? brief?.data?.locale;
    const successMessage = locale === 'ro' ? 'Mesajul a fost trimis!' : 'Message sent!';

    const sourceUrl = request.headers.get('referer') || request.headers.get('origin') || null;
    const userAgent = (request.headers.get('user-agent') || '').slice(0, 400);
    const supabase = createAdminClient();

    // ── Save submission to DB so it shows up in the dashboard inbox ─────────
    const { data: inserted, error: insertErr } = await supabase
      .from('contact_submissions')
      .insert({
        project_id: projectId,
        type,
        name:    allFields.name    ?? null,
        email:   emailVal          || null,
        subject: allFields.subject ?? null,
        message: messageVal        || JSON.stringify(allFields),
        source_url: sourceUrl,
        ip,
        user_agent: userAgent,
        status: 'new',
        forwarded: false,
      })
      .select('id')
      .single();

    if (insertErr) {
      console.error('[forms] DB insert failed:', insertErr);
      // Fall through — still try to forward; don't block the visitor
    }

    // ── Tier-based forwarding ───────────────────────────────────────────────
    const isPaid = project.billing_status === 'active';
    let shouldForward = true;
    if (!isPaid && inserted) {
      const monthStart = new Date();
      monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
      const { count } = await supabase
        .from('contact_submissions')
        .select('id', { count: 'exact', head: true })
        .eq('project_id', projectId)
        .eq('forwarded', true)
        .gte('created_at', monthStart.toISOString());
      if ((count ?? 0) >= FREE_FORWARD_LIMIT) shouldForward = false;
    }

    // Resolve recipient — prefer brief.contact.email (what the user told the AI on
    // the site), fall back to the platform account email so the owner always gets it.
    let recipient = brief?.data?.contact?.email as string | undefined;
    if (!recipient) {
      const owner = await db.users.findById(project.user_id);
      recipient = owner?.email;
    }

    if (shouldForward && recipient) {
      const siteName = brief?.data?.business?.name || project.name || 'Site';
      const siteUrl = project.preview_url || undefined;
      const result = await sendFormEmail({ to: recipient, siteName, siteUrl, submission: allFields });
      if (result.success && inserted) {
        await supabase.from('contact_submissions').update({ forwarded: true }).eq('id', inserted.id);
      } else if (!result.success) {
        console.warn('[forms] Resend forward failed:', result.error);
      }
    } else if (!shouldForward) {
      console.log(`[forms] Free-tier monthly forward cap reached for project ${projectId} — saved to inbox only`);
    }

    return jsonCors({ success: true, message: successMessage }, 201);
  } catch (e: any) {
    console.error('[forms] Error:', e);
    return jsonCors({ error: 'Internal error' }, 500);
  }
};
