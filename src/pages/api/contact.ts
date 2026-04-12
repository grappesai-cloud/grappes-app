import type { APIRoute } from 'astro';

import { json } from '../../lib/api-utils';
import { checkRateLimit, getClientIp } from '../../lib/rate-limit';
const RESEND_API = 'https://api.resend.com/emails';


export const POST: APIRoute = async ({ request }) => {
  // 5 contact submissions/hour per IP
  const ip = getClientIp(request);
  if (!checkRateLimit(`contact:${ip}`, 5, 3_600_000)) {
    return json({ error: 'Too many messages. Please try again later.' }, 429);
  }

  const apiKey = import.meta.env.RESEND_API_KEY;
  if (!apiKey) return json({ error: 'Email service not configured' }, 500);

  const adminEmail = import.meta.env.ADMIN_EMAIL || 'hello@grappes.ai';

  try {
    const body = await request.json().catch(() => ({}));
    const { name, email, phone, service, message } = body as Record<string, string>;

    if (!name?.trim() || !email?.trim()) {
      return json({ error: 'Name and email are required' }, 400);
    }

    const html = `
      <div style="font-family:-apple-system,sans-serif;max-width:600px;margin:0 auto">
        <div style="background:#0a0a0a;color:#fff;padding:24px 28px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;font-size:18px">New contact from grappes.ai</h2>
        </div>
        <div style="border:1px solid #e5e5e5;border-top:none;padding:24px 28px;border-radius:0 0 12px 12px">
          <table style="width:100%;border-collapse:collapse;font-size:15px">
            <tr><td style="padding:8px 0;font-weight:600;color:#555;width:100px">Name</td><td style="padding:8px 0">${escapeHtml(name)}</td></tr>
            <tr><td style="padding:8px 0;font-weight:600;color:#555">Email</td><td style="padding:8px 0"><a href="mailto:${escapeHtml(email)}">${escapeHtml(email)}</a></td></tr>
            ${phone ? `<tr><td style="padding:8px 0;font-weight:600;color:#555">Phone</td><td style="padding:8px 0">${escapeHtml(phone)}</td></tr>` : ''}
            ${service ? `<tr><td style="padding:8px 0;font-weight:600;color:#555">Service</td><td style="padding:8px 0">${escapeHtml(service)}</td></tr>` : ''}
            ${message ? `<tr><td style="padding:8px 0;font-weight:600;color:#555;vertical-align:top">Message</td><td style="padding:8px 0">${escapeHtml(message)}</td></tr>` : ''}
          </table>
        </div>
      </div>`;

    const res = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from: 'Grappes <noreply@grappes.ai>',
        to: adminEmail,
        subject: `[Grappes] New contact: ${name}`,
        html,
        reply_to: email,
      }),
    });

    const data = await res.json();

    if (!res.ok) {
      console.error('[contact] Resend error:', data);
      return json({ error: 'Failed to send email' }, 500);
    }

    return json({ success: true });
  } catch (e: any) {
    console.error('[contact] Error:', e);
    return json({ error: 'Server error' }, 500);
  }
};

function escapeHtml(str: string): string {
  return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
