// ─── Public Form Submission Endpoint ─────────────────────────────────────────
// Called by contact forms on generated/deployed websites.
// Receives form data, sends email to site owner via Resend.
// No auth required — public endpoint accessed by site visitors.

import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { sendFormEmail } from '../../../lib/resend';
import { checkRateLimit, getClientIp } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';


// CORS preflight
export const OPTIONS: APIRoute = async () => {
  return new Response(null, {
    status: 204,
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    },
  });
};

export const POST: APIRoute = async ({ params, request }) => {
  const projectId = params.projectId;
  if (!projectId) return json({ error: 'Missing project ID' }, 400);

  const ip = getClientIp(request);

  // Per-project: max 10 submissions/hour
  if (!checkRateLimit(`form:project:${projectId}`, 10, 3_600_000)) {
    return json({ error: 'Too many submissions. Please try again later.' }, 429);
  }
  // Per-IP: max 20 submissions/hour across all projects (stops single attacker)
  if (!checkRateLimit(`form:ip:${ip}`, 20, 3_600_000)) {
    return json({ error: 'Too many submissions. Please try again later.' }, 429);
  }

  try {
    const body = await request.json().catch(() => ({}));

    const { name, email, phone, message, subject, ...extra } = body;
    // Cap extra fields to prevent email size abuse
    const cappedExtra: Record<string, string> = {};
    let extraCount = 0;
    for (const [k, v] of Object.entries(extra)) {
      if (extraCount >= 10) break;
      if (typeof v === 'string') { cappedExtra[k] = v; extraCount++; }
    }
    const allFields: Record<string, string | undefined> = { name, email, phone, message, subject, ...cappedExtra };
    const filledFields = Object.values(allFields).filter(v => v && typeof v === 'string' && v.trim());

    if (filledFields.length === 0) {
      return json({ error: 'Empty submission' }, 400);
    }

    // Sanitize field lengths
    for (const [key, val] of Object.entries(allFields)) {
      if (typeof val === 'string' && val.length > 5000) {
        allFields[key] = val.slice(0, 5000);
      }
    }

    const project = await db.projects.findById(projectId);
    if (!project) return json({ error: 'Site not found' }, 404);

    const brief = await db.briefs.findByProjectId(projectId);
    const ownerEmail = brief?.data?.contact?.email;

    const locale = brief?.data?.locale;
    const successMessage = locale === 'en'
      ? 'Message sent!'
      : locale === 'ro'
        ? 'Mesajul a fost trimis!'
        : 'Mesajul a fost trimis! / Message sent!';

    if (!ownerEmail) {
      console.warn(`[forms] Project ${projectId} has no contact email — submission dropped`);
      return json({ success: true, message: successMessage });
    }

    const siteName = brief?.data?.business?.name || project.name || 'Site';
    const siteUrl = project.preview_url || undefined;

    const result = await sendFormEmail({ to: ownerEmail, siteName, siteUrl, submission: allFields });

    if (result.success) {
      console.log(`[forms] Email sent for project ${projectId} → ${ownerEmail}`);
    } else {
      console.error(`[forms] Email failed for project ${projectId}:`, result.error);
    }

    // Always return success — don't expose internal state to visitors
    return json({ success: true, message: successMessage });

  } catch (e: any) {
    console.error('[forms] Error:', e);
    return json({ error: 'Internal error' }, 500);
  }
};
