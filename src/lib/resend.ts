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
 * Alert to admin when a referrer crosses the 50€ payout threshold.
 */
export async function sendReferralPayoutAlert(params: {
  referrerEmail: string;
  amount: number;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const adminEmail = import.meta.env.ADMIN_EMAIL;
  if (!adminEmail) {
    console.error('[resend] ADMIN_EMAIL not set — payout alert not sent');
    return { success: false, error: 'ADMIN_EMAIL not configured' };
  }
  const html = wrapEmail('Referral payout to process', `
    <p style="margin:0 0 20px;"><span style="color:#0a0a0a;font-weight:500;">${escapeHtml(params.referrerEmail)}</span> has accumulated <span style="color:#0a0a0a;font-weight:700;">${params.amount.toFixed(2)}€</span> in referral earnings.</p>
    <p style="margin:0;">Reach out to them and request their IBAN to process the payout.</p>
  `);

  const text = `Referral payout to process\n\n${params.referrerEmail} has accumulated ${params.amount.toFixed(2)}€ in referral earnings.\n\nReach out to them and request their IBAN to process the payout.`;

  return sendPlatformEmail({
    to: adminEmail,
    subject: `Referral payout — ${params.amount.toFixed(2)}€ for ${params.referrerEmail}`,
    html,
    text,
  });
}

/**
 * Email to referrer when they earn a reward.
 */
export async function sendReferralEarnedEmail(params: {
  to: string;
  userId?: string;
  amount: number;
  newBalance: number;
  plan: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const planLabel = params.plan === 'agency' ? 'Lifetime' : params.plan === 'pro' ? 'Annual' : 'Monthly';
  const html = wrapEmail(`+${params.amount}€ referral earned`, `
    <p style="margin:0 0 24px;">Someone you referred just purchased the <span style="color:#0a0a0a;font-weight:600;">${planLabel}</span> plan.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 24px;">
      <tr>
        <td style="padding:12px 0;color:#9ca3af;border-bottom:1px solid #f0f0f0;">Earned now</td>
        <td style="padding:12px 0;color:#0a0a0a;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">+${params.amount}€</td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#9ca3af;">Balance</td>
        <td style="padding:12px 0;color:#0a0a0a;font-weight:600;text-align:right;">${params.newBalance.toFixed(2)}€</td>
      </tr>
    </table>
    ${params.newBalance >= 50 ? `<p style="margin:0 0 4px;font-size:14px;color:#059669;font-weight:500;">You've reached the 50€ minimum — we'll contact you to process payout.</p>` : `<p style="margin:0 0 4px;font-size:13px;color:#9ca3af;">Once you reach 50€ we'll process a bank payout.</p>`}
    ${emailBtn(`${SITE_URL}/dashboard/referrals`, 'View stats →')}
  `);

  const text = `+${params.amount}€ referral earned\n\nSomeone you referred just purchased the ${planLabel} plan.\n\nEarned now: +${params.amount}€\nBalance: ${params.newBalance.toFixed(2)}€\n\n${params.newBalance >= 50 ? "You've reached the 50€ minimum — we'll contact you to process payout." : 'Once you reach 50€ we\'ll process a bank payout.'}\n\nView your referral stats: ${SITE_URL}/dashboard/referrals`;

  const headers: Record<string, string> = {};
  if (params.userId) {
    const token = generateUnsubToken(params.userId);
    headers['List-Unsubscribe'] = `<https://grappes.dev/api/unsubscribe?token=${token}&uid=${params.userId}>`;
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  }

  return sendPlatformEmail({
    to: params.to,
    subject: `+${params.amount}€ earned from Grappes referral`,
    html,
    text,
    reply_to: 'support@grappes.dev',
    headers: Object.keys(headers).length > 0 ? headers : undefined,
  });
}

/**
 * Notification when a site subscription is cancelled/expired.
 */
export async function sendSubscriptionCancelledEmail(params: {
  to: string;
  siteName: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail('Subscription cancelled', `
    <p style="margin:0 0 24px;">The subscription for <span style="color:#0a0a0a;font-weight:600;">${escapeHtml(params.siteName)}</span> has been cancelled. The site is no longer active.</p>
    <p style="margin:0 0 4px;">You can reactivate anytime from your dashboard.</p>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Reactivate →')}
  `);

  const text = `Subscription cancelled\n\nThe subscription for ${params.siteName} has been cancelled. The site is no longer active.\n\nYou can reactivate anytime from your dashboard.\n\nOpen dashboard: ${SITE_URL}/dashboard`;

  return sendPlatformEmail({
    to: params.to,
    subject: `${params.siteName} — subscription cancelled`,
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
 * Admin alert when a domain purchase fails after payment.
 */
export async function sendDomainPurchaseFailedEmail(params: {
  domain: string;
  projectId: string;
  error: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const adminEmail = import.meta.env.ADMIN_EMAIL;
  if (!adminEmail) return { success: false, error: 'ADMIN_EMAIL not configured' };
  const html = wrapEmail('Domain purchase failed', `
    <p style="margin:0 0 24px;">The purchase of the domain <span style="color:#0a0a0a;font-weight:600;">${escapeHtml(params.domain)}</span> failed after payment.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Details</p>
    <p style="margin:0 0 4px;font-size:13px;color:#9ca3af;">Project: ${escapeHtml(params.projectId)}</p>
    <p style="margin:0;font-size:13px;color:#9ca3af;">Error: ${escapeHtml(params.error)}</p>
  `);

  const text = `Domain purchase failed\n\nThe purchase of the domain ${params.domain} failed after payment.\n\nProject: ${params.projectId}\nError: ${params.error}`;

  return sendPlatformEmail({
    to: adminEmail,
    subject: `⚠ Domain failed: ${params.domain}`,
    html,
    text,
  });
}

/**
 * Confirmation email when extra edits pack is purchased.
 */
export async function sendPaymentConfirmedEmail(params: {
  to: string;
  // Legacy edits-only callers can still pass editsAdded + totalExtra.
  editsAdded?: number;
  totalExtra?: number;
  // New generic callers pass these directly for any product.
  productName?: string;       // e.g. "Reel Lab credits"
  amountAdded?: number;       // e.g. 10
  unitLabel?: string;         // e.g. "credits", "audits", "edits"
  newBalance?: number;        // e.g. 12
  ctaUrl?: string;            // override default dashboard URL
  ctaLabel?: string;          // override default "Open dashboard"
}): Promise<{ success: boolean; id?: string; error?: string }> {
  // Resolve fields, with edits-style fallback for legacy calls
  const productName = params.productName ?? 'AI edits';
  const amountAdded = params.amountAdded ?? params.editsAdded ?? 0;
  const unitLabel   = params.unitLabel ?? 'edits';
  const newBalance  = params.newBalance ?? params.totalExtra ?? amountAdded;
  const ctaUrl      = params.ctaUrl ?? `${SITE_URL}/dashboard`;
  const ctaLabel    = params.ctaLabel ?? 'Open Studio →';

  const html = wrapEmail('Payment confirmed', `
    <p style="margin:0 0 24px;">We've added <span style="color:#0a0a0a;font-weight:700;">+${amountAdded} ${escapeHtml(unitLabel)}</span> to your <strong>${escapeHtml(productName)}</strong> balance.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 24px;">
      <tr>
        <td style="padding:12px 0;color:#9ca3af;border-bottom:1px solid #f0f0f0;">Added</td>
        <td style="padding:12px 0;color:#0a0a0a;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">+${amountAdded} ${escapeHtml(unitLabel)}</td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#9ca3af;">Total remaining</td>
        <td style="padding:12px 0;color:#0a0a0a;font-weight:600;text-align:right;">${newBalance} ${escapeHtml(unitLabel)}</td>
      </tr>
    </table>
    ${emailBtn(ctaUrl, ctaLabel)}
  `);

  const text = `Payment confirmed

We've added +${amountAdded} ${unitLabel} to your ${productName} balance.

Added: +${amountAdded} ${unitLabel}
Total remaining: ${newBalance} ${unitLabel}

${ctaLabel.replace(/ →$/, '')}: ${ctaUrl}`;

  return sendPlatformEmail({
    to: params.to,
    subject: `+${amountAdded} ${unitLabel} added · ${productName}`,
    html,
    text,
    reply_to: 'support@grappes.dev',
  });
}

/**
 * Press Kit Lab specific: kit was published successfully.
 */
export async function sendKitPublishedEmail(params: {
  to: string;
  kitName: string;
  publicUrl: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail(`${escapeHtml(params.kitName)} is published.`, `
    <p style="margin:0 0 24px;">Your press kit is live and ready to share. Anyone with the link can view it; nobody can edit it but you.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">Shareable URL</p>
    <p style="margin:0;"><a href="${escapeHtml(params.publicUrl)}" style="color:#0a0a0a;text-decoration:underline;word-break:break-all;">${escapeHtml(params.publicUrl)}</a></p>
    ${emailBtn(escapeHtml(params.publicUrl), 'View kit →')}
    <p style="margin:24px 0 0;font-size:13px;color:#c0c0c0;">You can keep editing the content anytime, or send the URL with <code style="background:#f5f5f5;padding:2px 6px;border-radius:4px;">?print=1</code> appended for a one-click PDF.</p>
  `);

  const text = `${params.kitName} is published.

Your press kit is live and ready to share.

URL: ${params.publicUrl}

You can keep editing the content anytime. Add ?print=1 to the URL for a one-click PDF download.`;

  return sendPlatformEmail({
    to: params.to,
    subject: `✦ ${params.kitName} is published`,
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
