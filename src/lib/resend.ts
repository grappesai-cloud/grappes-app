// ─── Resend Email Client ─────────────────────────────────────────────────────
// Sends form submission emails to site owners when visitors submit contact forms.

import { createHmac } from 'node:crypto';
import { checkRateLimit } from './rate-limit';

const RESEND_API = 'https://api.resend.com/emails';
const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.dev';

function getApiKey(): string {
  const key = import.meta.env.RESEND_API_KEY;
  if (!key) {
    console.error('[resend] RESEND_API_KEY not set');
    return '';
  }
  return key;
}

/** Strip control characters that could enable SMTP header injection */
function sanitizeHeader(s: string): string {
  return s.replace(/[\r\n\x00]/g, '').slice(0, 200);
}

/** Validate email format (basic RFC 5322) */
function isValidEmail(s: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s) && s.length <= 254;
}

/** Generate unsubscribe token for marketing emails */
function generateUnsubToken(userId: string): string {
  const secret = import.meta.env.UNSUB_SECRET || 'default-unsub-secret';
  return createHmac('sha256', secret).update(userId).digest('hex');
}

/**
 * Check if an email is suppressed.
 */
export async function isEmailSuppressed(email: string): Promise<boolean> {
  try {
    const { createAdminClient } = await import('./supabase');
    const client = createAdminClient();
    const { data } = await client
      .from('suppressed_emails')
      .select('email')
      .eq('email', email.toLowerCase())
      .maybeSingle();
    return !!data;
  } catch {
    return false;
  }
}

/**
 * Suppress an email address with an optional reason.
 */
export async function suppressEmail(email: string, reason: string): Promise<void> {
  try {
    const { createAdminClient } = await import('./supabase');
    const client = createAdminClient();
    await client
      .from('suppressed_emails')
      .upsert({ email: email.toLowerCase(), reason }, { onConflict: 'email' });
  } catch (e) {
    console.error('[resend] Failed to suppress email:', e);
  }
}

export interface FormSubmission {
  name?: string;
  email?: string;
  phone?: string;
  message?: string;
  subject?: string;
  [key: string]: string | undefined;
}

export async function sendFormEmail(params: {
  to: string;
  siteName: string;
  siteUrl?: string;
  submission: FormSubmission;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const { to, siteName, siteUrl, submission } = params;

  const fields = Object.entries(submission)
    .filter(([_, v]) => v && v.trim())
    .map(([key, value]) => {
      const label = key.charAt(0).toUpperCase() + key.slice(1).replace(/_/g, ' ');
      return `<tr><td style="padding:12px 0;font-weight:500;color:#9ca3af;vertical-align:top;white-space:nowrap;border-bottom:1px solid #f0f0f0;width:100px;">${label}</td><td style="padding:12px 0 12px 16px;color:#374151;border-bottom:1px solid #f0f0f0;">${escapeHtml(value!)}</td></tr>`;
    })
    .join('');

  const html = wrapFormEmail(siteName, `
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">${fields}</table>
    ${siteUrl ? `<p style="margin:20px 0 0;font-size:13px;color:#c0c0c0;">Trimis de pe <a href="${escapeHtml(siteUrl)}" style="color:#6b7280;text-decoration:none;">${escapeHtml(siteUrl)}</a></p>` : ''}
  `);

  const text = `New form submission${submission.name ? ` from ${submission.name}` : ''}:\n\n${Object.entries(submission)
    .filter(([_, v]) => v && v.trim())
    .map(([key, value]) => `${key}: ${value}`)
    .join('\n')}${siteUrl ? `\n\nSubmitted from: ${siteUrl}` : ''}`;

  const safeSiteName = sanitizeHeader(siteName);
  const subject = submission.subject
    ? `[${safeSiteName}] ${sanitizeHeader(submission.subject)}`
    : `[${safeSiteName}] Mesaj nou de pe site${submission.name ? ` — ${sanitizeHeader(submission.name)}` : ''}`;

  // Validate reply_to email format to prevent header injection
  const replyTo = submission.email && isValidEmail(submission.email) ? submission.email : undefined;

  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        from: `${safeSiteName} <noreply@grappes.dev>`,
        to,
        subject,
        html,
        text,
        reply_to: replyTo,
      }),
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('[resend] Send failed:', data);
      return { success: false, error: data.message || 'Send failed' };
    }

    return { success: true, id: data.id };
  } catch (e: any) {
    console.error('[resend] Error:', e);
    return { success: false, error: e.message };
  }
}

function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ─── Platform emails ──────────────────────────────────────────────────────────

export async function sendPlatformEmailInternal(params: {
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  return sendPlatformEmail(params);
}

async function sendPlatformEmail(params: {
  to: string;
  subject: string;
  html: string;
  reply_to?: string;
  text?: string;
  headers?: Record<string, string>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    // Check if email is suppressed
    const suppressed = await isEmailSuppressed(params.to);
    if (suppressed) {
      console.log(`[resend] Email to ${params.to} is suppressed`);
      return { success: false, error: 'Email suppressed' };
    }

    // Check per-user rate limit (5 emails per hour per user)
    const rateLimitKey = `email:user:${params.to}`;
    const limited = await checkRateLimit(rateLimitKey, 5, 3_600_000);
    if (!limited) {
      console.warn(`[resend] Rate limit exceeded for ${params.to}`);
      return { success: false, error: 'Rate limit exceeded' };
    }

    const body: any = {
      from: 'Grappes <noreply@grappes.dev>',
      to: params.to,
      subject: params.subject,
      html: params.html,
    };

    if (params.text) {
      body.text = params.text;
    }

    if (params.reply_to) {
      body.reply_to = params.reply_to;
    }

    if (params.headers) {
      body.headers = params.headers;
    }

    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify(body),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error('[resend] Platform email failed:', data);
      return { success: false, error: data.message || 'Send failed' };
    }
    return { success: true, id: data.id };
  } catch (e: any) {
    console.error('[resend] Platform email error:', e);
    return { success: false, error: e.message };
  }
}

const LOGO_URL = `${SITE_URL}/logo-email-dark.png`;

function wrapEmail(title: string, body: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;margin:0;padding:0;">
<tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:48px 24px;">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;font-family:'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif;">

  <tr><td style="padding:0 0 40px;">
    <img src="${LOGO_URL}" alt="Grappes" width="120" height="27" style="display:block;border:0;" />
  </td></tr>

  <tr><td style="padding:0 0 16px;">
    <h1 style="margin:0;font-size:26px;font-weight:600;color:#0a0a0a;letter-spacing:-0.03em;line-height:1.3;">${title}</h1>
  </td></tr>

  <tr><td style="padding:0 0 32px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="2" bgcolor="#00FF97" style="background:linear-gradient(90deg,#2C32FE,#00A4AF,#00FF97);font-size:0;line-height:0;">&nbsp;</td></tr></table>
  </td></tr>

  <tr><td style="font-size:15px;line-height:1.75;color:#6b7280;">
    ${body}
  </td></tr>

  <tr><td style="padding:48px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="#f0f0f0" style="font-size:0;line-height:0;">&nbsp;</td></tr></table>
  </td></tr>

  <tr><td style="padding:20px 0 0;font-size:12px;color:#c0c0c0;letter-spacing:0.02em;">
    Grappes · <a href="${SITE_URL}" style="color:#c0c0c0;text-decoration:none;">grappes.dev</a> · <a href="${SITE_URL}/dashboard/account" style="color:#c0c0c0;text-decoration:none;">Manage notifications</a>
  </td></tr>

</table>
</td></tr>
</table>`;
}

/** White-label email wrapper for form submissions — no Grappes branding */
function wrapFormEmail(siteName: string, body: string): string {
  return `
<table width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="background-color:#ffffff;margin:0;padding:0;">
<tr><td align="center" bgcolor="#ffffff" style="background-color:#ffffff;padding:48px 24px;">
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;font-family:'DM Sans','Helvetica Neue',Helvetica,Arial,sans-serif;">

  <tr><td style="padding:0 0 16px;">
    <h1 style="margin:0;font-size:26px;font-weight:600;color:#0a0a0a;letter-spacing:-0.03em;line-height:1.3;">Mesaj nou</h1>
  </td></tr>

  <tr><td style="padding:0 0 32px;">
    <table cellpadding="0" cellspacing="0" border="0"><tr><td width="40" height="2" bgcolor="#00FF97" style="background:linear-gradient(90deg,#2C32FE,#00A4AF,#00FF97);font-size:0;line-height:0;">&nbsp;</td></tr></table>
  </td></tr>

  <tr><td style="font-size:15px;line-height:1.75;color:#6b7280;">
    ${body}
  </td></tr>

  <tr><td style="padding:48px 0 0;">
    <table width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td height="1" bgcolor="#f0f0f0" style="font-size:0;line-height:0;">&nbsp;</td></tr></table>
  </td></tr>

  <tr><td style="padding:20px 0 0;font-size:12px;color:#c0c0c0;letter-spacing:0.02em;">
    ${escapeHtml(siteName)}
  </td></tr>

</table>
</td></tr>
</table>`;
}

function emailBtn(href: string, text: string): string {
  return `<table cellpadding="0" cellspacing="0" border="0" style="margin:28px 0 0;"><tr><td bgcolor="#0a0a0a" style="background-color:#0a0a0a;border-radius:50px;padding:14px 32px;"><a href="${href}" style="color:#ffffff;font-weight:600;font-size:14px;text-decoration:none;letter-spacing:-0.01em;">${text}</a></td></tr></table>`;
}

/**
 * Welcome email sent when a user signs up.
 */
export async function sendWelcomeEmail(params: {
  to: string;
  name?: string;
  userId?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const greeting = params.name ? `Welcome, ${escapeHtml(params.name)}.` : 'Welcome.';
  const html = wrapEmail(greeting, `
    <p style="margin:0 0 24px;">Your account is active. Grappes is an AI creative studio with four tools, all ready for you now.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">What you can do</p>
    <ul style="margin:0 0 4px;padding-left:18px;font-size:14px;line-height:2;color:#6b7280;">
      <li><strong style="color:#0a0a0a;">Sites</strong> · generate a complete website from a brief in 15 minutes</li>
      <li><strong style="color:#0a0a0a;">Reels Lab</strong> · upload a reel, get a frame-by-frame AI breakdown with hook and retention scores</li>
      <li><strong style="color:#0a0a0a;">Audit Lab</strong> · paste any URL, get a 30-second AI audit with concrete fixes (your first audit is free)</li>
      <li><strong style="color:#0a0a0a;">Press Kit Lab</strong> · compose a digital press kit with AI-generated logo, shareable URL and printable PDF</li>
    </ul>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Open Studio →')}
  `);

  const text = `Welcome to Grappes!

Your account is active. Grappes is an AI creative studio with four tools, all ready for you now:

- Sites: generate a complete website from a brief in 15 minutes
- Reels Lab: upload a reel, get a frame-by-frame AI breakdown with hook and retention scores
- Audit Lab: paste any URL, get a 30-second AI audit with concrete fixes (your first audit is free)
- Press Kit Lab: compose a digital press kit with AI-generated logo, shareable URL and printable PDF

Open Studio: ${SITE_URL}/dashboard`;

  const headers: Record<string, string> = {};
  if (params.userId) {
    const token = generateUnsubToken(params.userId);
    headers['List-Unsubscribe'] = `<https://grappes.dev/api/unsubscribe?token=${token}&uid=${params.userId}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  return sendPlatformEmail({
    to: params.to,
    subject: 'Welcome to Grappes Studio',
    html,
    text,
    reply_to: 'support@grappes.dev',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

/**
 * Account credentials email — sent when an admin provisions an account with a
 * generated password. The recipient signs in with this email + password.
 */
export async function sendAccountCredentialsEmail(params: {
  to: string;
  name?: string;
  password: string;
  tools?: string[];
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const greeting = params.name ? `Welcome, ${escapeHtml(params.name)}.` : 'Your account is ready.';
  const signInUrl = `${SITE_URL}/sign-in`;
  const toolsLine = params.tools && params.tools.length
    ? `<p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Your tools</p>
       <p style="margin:0 0 24px;">${params.tools.map((t) => escapeHtml(t)).join(' · ')}</p>`
    : '';
  const html = wrapEmail(greeting, `
    <p style="margin:0 0 24px;">An account has been created for you on Grappes Studio. Sign in with the credentials below.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 8px;width:100%;background:#f7f7f8;border-radius:12px;">
      <tr><td style="padding:18px 20px;font-size:14px;line-height:1.9;color:#0a0a0a;">
        <strong style="color:#6b7280;font-weight:600;">Email</strong><br>${escapeHtml(params.to)}<br>
        <strong style="color:#6b7280;font-weight:600;">Password</strong><br>
        <span style="font-family:'SFMono-Regular',Consolas,monospace;font-size:15px;letter-spacing:0.02em;">${escapeHtml(params.password)}</span>
      </td></tr>
    </table>
    <p style="margin:8px 0 24px;font-size:13px;color:#9ca3af;">You can change this password anytime from your account settings.</p>
    ${toolsLine}
    ${emailBtn(signInUrl, 'Sign in →')}
  `);
  const text = `Your Grappes account is ready.

Sign in at ${signInUrl}

Email: ${params.to}
Password: ${params.password}

You can change this password anytime from your account settings.`;

  return sendPlatformEmail({
    to: params.to,
    subject: 'Your Grappes account is ready',
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}

/**
 * Operator notification (concierge flow): a client finished onboarding and their
 * site is ready to be built by hand. Sent to ADMIN_EMAIL with the full brief so
 * the operator can build it in Claude Code and deliver it via the API.
 */
export async function sendManualBuildRequestEmail(params: {
  projectId: string;
  projectName: string;
  clientEmail: string;
  clientName?: string;
  brief: any;
  assetCount?: number;
  assets?: Array<{ type?: string; url: string; filename?: string | null }>;
  conversation?: Array<{ role: string; content: string }>;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const adminEmail = import.meta.env.ADMIN_EMAIL ?? 'grappes.ai@gmail.com';
  const briefJson = JSON.stringify(params.brief ?? {}, null, 2);
  const convo = (params.conversation ?? []).filter((m) => (m.content ?? '').trim());
  const convoBlock = convo.length
    ? `<p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Onboarding — exact Q&amp;A (unedited)</p>
       <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 28px;width:100%;background:#f7f7f8;border-radius:12px;"><tr><td style="padding:16px 20px;">
       ${convo.map((m) => {
         const isUser = m.role === 'user';
         return `<p style="margin:0 0 12px;"><span style="display:block;font-size:10px;font-weight:700;letter-spacing:0.08em;text-transform:uppercase;color:${isUser ? '#2C32FE' : '#9ca3af'};margin-bottom:2px;">${isUser ? 'Client' : 'Question'}</span><span style="color:#0a0a0a;font-size:14px;line-height:1.55;white-space:pre-wrap;word-break:break-word;">${escapeHtml(m.content)}</span></p>`;
       }).join('')}
       </td></tr></table>`
    : '';
  const assets = params.assets ?? [];
  const assetCount = params.assetCount ?? assets.length;
  const mediaLine = `<br><strong style="color:#6b7280;font-weight:600;">Uploaded media</strong><br>${assetCount} file(s)`;
  const mediaBlock = assets.length
    ? `<p style="margin:24px 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Media (${assets.length})</p>
       <table cellpadding="0" cellspacing="0" border="0" style="margin:0;width:100%;font-size:13px;line-height:1.9;">
       ${assets.map((a) => `<tr><td style="padding:2px 0;color:#9ca3af;white-space:nowrap;padding-right:12px;vertical-align:top;">${escapeHtml(a.type || 'file')}${a.filename ? ` · ${escapeHtml(a.filename)}` : ''}</td><td style="padding:2px 0;"><a href="${escapeHtml(a.url)}" style="color:#2C32FE;text-decoration:none;word-break:break-all;">${escapeHtml(a.url)}</a></td></tr>`).join('')}
       </table>`
    : `<p style="margin:24px 0 0;font-size:13px;color:#9ca3af;">No media uploaded by the client.</p>`;
  const html = wrapEmail(`New site to build: ${escapeHtml(params.projectName)}`, `
    <p style="margin:0 0 20px;"><span style="color:#0a0a0a;font-weight:600;">${escapeHtml(params.clientName || params.clientEmail)}</span> finished onboarding. Build the site in Claude Code, then deliver it via the API.</p>
    <table cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px;width:100%;background:#f7f7f8;border-radius:12px;">
      <tr><td style="padding:16px 20px;font-size:14px;line-height:1.9;color:#0a0a0a;">
        <strong style="color:#6b7280;font-weight:600;">Project</strong><br>${escapeHtml(params.projectName)}<br>
        <strong style="color:#6b7280;font-weight:600;">Project ID</strong><br><span style="font-family:'SFMono-Regular',Consolas,monospace;font-size:13px;">${escapeHtml(params.projectId)}</span><br>
        <strong style="color:#6b7280;font-weight:600;">Client</strong><br>${escapeHtml(params.clientEmail)}${mediaLine}
      </td></tr>
    </table>
    ${convoBlock}
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Brief (structured summary)</p>
    <pre style="margin:0;padding:16px;background:#0a0a0a;color:#e5e7eb;border-radius:10px;font-size:12px;line-height:1.6;white-space:pre-wrap;word-break:break-word;font-family:'SFMono-Regular',Consolas,monospace;">${escapeHtml(briefJson)}</pre>
    ${mediaBlock}
    ${emailBtn(`${SITE_URL}/admin`, 'Open admin →')}
  `);
  const mediaText = assets.length
    ? `\n\nMedia (${assets.length}):\n${assets.map((a) => `- ${a.type || 'file'}${a.filename ? ` (${a.filename})` : ''}: ${a.url}`).join('\n')}`
    : `\n\nMedia: none uploaded.`;
  const convoText = convo.length
    ? `\n\nOnboarding — exact Q&A (unedited):\n${convo.map((m) => `${m.role === 'user' ? 'CLIENT' : 'Q'}: ${m.content}`).join('\n\n')}`
    : '';
  const text = `New site to build: ${params.projectName}

Client: ${params.clientEmail}
Project ID: ${params.projectId}${convoText}

Brief (structured summary):
${briefJson}${mediaText}

Pull brief:  GET  ${SITE_URL}/api/admin/projects/${params.projectId}/brief
Deliver:     POST ${SITE_URL}/api/admin/projects/${params.projectId}/deliver  (x-admin-secret header, body = HTML)`;

  return sendPlatformEmail({
    to: adminEmail,
    subject: `🛠 Build request: ${params.projectName}`,
    html,
    text,
    reply_to: params.clientEmail || undefined,
  });
}

/**
 * Client notification (concierge flow): their hand-built site is ready to view.
 */
export async function sendSiteReadyEmail(params: {
  to: string;
  siteName: string;
  projectId: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const dashUrl = `${SITE_URL}/dashboard/${params.projectId}`;
  const html = wrapEmail(`${escapeHtml(params.siteName)} is ready.`, `
    <p style="margin:0 0 24px;">Your website is ready to view. Sign in to see it, then publish it and connect your own domain whenever you're happy with it.</p>
    ${emailBtn(dashUrl, 'View your site →')}
    <p style="margin:24px 0 0;font-size:13px;color:#c0c0c0;">Want changes? Just reply to this email.</p>
  `);
  const text = `${params.siteName} is ready!

Your website is ready to view. Sign in to see it:
${dashUrl}

From there you can publish it and connect your own domain. Want changes? Just reply to this email.`;

  return sendPlatformEmail({
    to: params.to,
    subject: `✦ ${params.siteName} is ready`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}

/**
 * Notification email when a site goes live after deployment.
 */
export async function sendSiteLiveEmail(params: {
  to: string;
  siteName: string;
  siteUrl: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail(`${escapeHtml(params.siteName)} is live.`, `
    <p style="margin:0 0 24px;">Your site has been published and is now live.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">URL</p>
    <p style="margin:0;"><a href="${escapeHtml(params.siteUrl)}" style="color:#0a0a0a;text-decoration:underline;word-break:break-all;">${escapeHtml(params.siteUrl)}</a></p>
    ${emailBtn(escapeHtml(params.siteUrl), 'Visit site →')}
    <p style="margin:24px 0 0;font-size:13px;color:#c0c0c0;">You can edit it anytime from your dashboard.</p>
  `);

  const text = `Your site is live!\n\n${params.siteName} has been published and is now live.\n\nURL: ${params.siteUrl}\n\nYou can edit it anytime from your dashboard.\n\nOpen dashboard: ${SITE_URL}/dashboard`;

  return sendPlatformEmail({
    to: params.to,
    subject: `✦ ${params.siteName} is live!`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}


/**
 * Notification when a deployment fails.
 */
export async function sendDeploymentFailedEmail(params: {
  to: string;
  siteName: string;
  error?: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail('Deployment failed', `
    <p style="margin:0 0 24px;">The deployment of <span style="color:#0a0a0a;font-weight:600;">${escapeHtml(params.siteName)}</span> failed.</p>
    ${params.error ? `<p style="margin:0 0 24px;font-size:13px;color:#9ca3af;font-family:monospace;background:#f9fafb;padding:12px;border-radius:6px;">${escapeHtml(params.error)}</p>` : ''}
    <p style="margin:0 0 4px;">Retry from your dashboard or contact support.</p>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Open dashboard →')}
  `);

  const text = `Deployment failed\n\nThe deployment of ${params.siteName} failed.${params.error ? `\n\nError: ${params.error}` : ''}\n\nRetry from your dashboard or contact support.\n\nOpen dashboard: ${SITE_URL}/dashboard`;

  return sendPlatformEmail({
    to: params.to,
    subject: `${params.siteName} — deployment failed`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}


/**
 * Transactional email when a user's password is changed.
 */
export async function sendPasswordResetEmail(params: {
  to: string;
  resetUrl: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail('Reset your password', `
    <p style="margin:0 0 24px;">Click the button below to reset your Grappes account password. This link expires in 1 hour.</p>
    ${emailBtn(params.resetUrl, 'Reset password →')}
    <p style="margin:24px 0 0;font-size:13px;color:#666;">If you didn't request this, you can safely ignore this email.</p>
  `);

  const text = `Reset your password\n\nClick the link below to reset your Grappes account password (expires in 1 hour):\n\n${params.resetUrl}\n\nIf you didn't request this, you can safely ignore this email.`;

  return sendPlatformEmail({
    to: params.to,
    subject: 'Reset your Grappes password',
    html,
    text,
  });
}

export async function sendPasswordChangedEmail(params: {
  to: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail('Password changed', `
    <p style="margin:0 0 24px;">Your password was just changed. If this wasn't you, reset it immediately.</p>
    ${emailBtn(`${SITE_URL}/forgot-password`, 'Reset password →')}
  `);

  const text = `Password changed\n\nYour password was just changed. If this wasn't you, reset it immediately.\n\nReset password: ${SITE_URL}/forgot-password`;

  return sendPlatformEmail({
    to: params.to,
    subject: 'Your Grappes password was changed',
    html,
    text,
  });
}

// ─── Trial lifecycle emails ──────────────────────────────────────────────────

/**
 * Email sent when a free site goes live — informs user of the 7-day trial.
 */
export async function sendTrialStartedEmail(params: {
  to: string;
  siteName: string;
  siteUrl: string;
  expiresAt: string; // ISO timestamp
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const expiryDate = new Date(params.expiresAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const html = wrapEmail(`${escapeHtml(params.siteName)} is live — 7-day trial`, `
    <p style="margin:0 0 24px;">Your site is now live and looking great! You have <span style="color:#0a0a0a;font-weight:700;">7 days</span> to try it out for free.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 24px;background:#f9fafb;border-radius:8px;">
      <tr>
        <td style="padding:16px 20px;color:#9ca3af;border-bottom:1px solid #f0f0f0;">Site</td>
        <td style="padding:16px 20px;color:#0a0a0a;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;"><a href="${escapeHtml(params.siteUrl)}" style="color:#0a0a0a;text-decoration:underline;">${escapeHtml(params.siteName)}</a></td>
      </tr>
      <tr>
        <td style="padding:16px 20px;color:#9ca3af;">Trial expires</td>
        <td style="padding:16px 20px;color:#0a0a0a;font-weight:600;text-align:right;">${expiryDate}</td>
      </tr>
    </table>
    <p style="margin:0 0 24px;">After the trial, your site will be taken offline and you'll need an active plan to keep it live or create new sites.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Plans start at €99/year</p>
    <p style="margin:0 0 4px;font-size:14px;">Activate now to keep your site live permanently.</p>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Activate your site →')}
  `);

  const text = `Your site is live — 7-day trial\n\n${params.siteName} is now live! You have 7 days to try it out for free.\n\nSite: ${params.siteUrl}\nTrial expires: ${expiryDate}\n\nAfter the trial, your site will be taken offline and you'll need an active plan to keep it live or create new sites.\n\nPlans start at €99/year. Activate now: ${SITE_URL}/dashboard`;

  return sendPlatformEmail({
    to: params.to,
    subject: `${params.siteName} is live — your 7-day free trial has started`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}

/**
 * Reminder email sent ~3-4 days into the trial.
 */
export async function sendTrialReminderEmail(params: {
  to: string;
  siteName: string;
  siteUrl: string;
  daysLeft: number;
  expiresAt: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const expiryDate = new Date(params.expiresAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const html = wrapEmail(`${params.daysLeft} days left on your trial`, `
    <p style="margin:0 0 24px;">Your free trial for <span style="color:#0a0a0a;font-weight:600;">${escapeHtml(params.siteName)}</span> expires on <span style="color:#0a0a0a;font-weight:600;">${expiryDate}</span>.</p>
    <p style="margin:0 0 24px;">After that, your site will be taken offline and the content will be deleted. You'll need to activate a plan to create or publish sites again.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Don't lose your site</p>
    <p style="margin:0 0 4px;font-size:14px;">Activate a plan now to keep ${escapeHtml(params.siteName)} live.</p>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Keep my site live →')}
  `);

  const text = `${params.daysLeft} days left on your trial\n\nYour free trial for ${params.siteName} expires on ${expiryDate}.\n\nAfter that, your site will be taken offline and the content will be deleted. You'll need to activate a plan to create or publish sites again.\n\nActivate now: ${SITE_URL}/dashboard`;

  return sendPlatformEmail({
    to: params.to,
    subject: `${params.daysLeft} days left — ${params.siteName} trial is ending soon`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}

/**
 * Final warning email sent 1 day before trial expiry.
 */
export async function sendTrialFinalWarningEmail(params: {
  to: string;
  siteName: string;
  siteUrl: string;
  expiresAt: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const expiryDate = new Date(params.expiresAt).toLocaleDateString('en-US', {
    month: 'long', day: 'numeric', year: 'numeric',
  });
  const html = wrapEmail('Last chance — your site goes offline tomorrow', `
    <p style="margin:0 0 24px;font-size:16px;color:#0a0a0a;font-weight:500;">Your free trial for <span style="font-weight:700;">${escapeHtml(params.siteName)}</span> expires <span style="color:#dc2626;font-weight:700;">tomorrow</span>.</p>
    <p style="margin:0 0 24px;">Once expired, your site will be taken offline and all generated content will be deleted. To publish or create sites in the future, you'll need an active plan.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 24px;background:#fef2f2;border-radius:8px;border:1px solid #fecaca;">
      <tr>
        <td style="padding:16px 20px;color:#991b1b;">
          <strong>Action required:</strong> Activate before ${expiryDate} to keep your site live.
        </td>
      </tr>
    </table>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Activate now — keep my site →')}
    <p style="margin:24px 0 0;font-size:13px;color:#c0c0c0;">Plans start at €99/year. Cancel anytime.</p>
  `);

  const text = `Last chance — your site goes offline tomorrow\n\nYour free trial for ${params.siteName} expires tomorrow (${expiryDate}).\n\nOnce expired, your site will be taken offline and all generated content will be deleted. To publish or create sites in the future, you'll need an active plan.\n\nActivate now: ${SITE_URL}/dashboard\n\nPlans start at €99/year. Cancel anytime.`;

  return sendPlatformEmail({
    to: params.to,
    subject: `⚠ Last day — ${params.siteName} goes offline tomorrow`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}

/**
 * Email sent when a trial site actually expires.
 */
export async function sendTrialExpiredEmail(params: {
  to: string;
  siteName: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail(`${escapeHtml(params.siteName)} has been taken offline`, `
    <p style="margin:0 0 24px;">Your 7-day free trial has ended and <span style="color:#0a0a0a;font-weight:600;">${escapeHtml(params.siteName)}</span> is no longer live.</p>
    <p style="margin:0 0 24px;">To bring your site back or create new ones, activate a paid plan. Your site content may still be recoverable if you act soon.</p>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Reactivate my site →')}
    <p style="margin:24px 0 0;font-size:13px;color:#c0c0c0;">Plans start at €99/year.</p>
  `);

  const text = `Your trial has ended\n\n${params.siteName} has been taken offline after the 7-day free trial.\n\nTo bring your site back or create new ones, activate a paid plan.\n\nReactivate: ${SITE_URL}/dashboard`;

  return sendPlatformEmail({
    to: params.to,
    subject: `${params.siteName} has been taken offline — trial ended`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}
