// ─── Resend Email Client ─────────────────────────────────────────────────────
// Sends form submission emails to site owners when visitors submit contact forms.

const RESEND_API = 'https://api.resend.com/emails';
const SITE_URL = import.meta.env.PUBLIC_SITE_URL ?? 'https://grappes.ai';

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
        from: `${safeSiteName} <noreply@grappes.ai>`,
        to,
        subject,
        html,
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
}): Promise<{ success: boolean; id?: string; error?: string }> {
  return sendPlatformEmail(params);
}

async function sendPlatformEmail(params: {
  to: string;
  subject: string;
  html: string;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  try {
    const response = await fetch(RESEND_API, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${getApiKey()}`,
      },
      body: JSON.stringify({
        from: 'Grappes <noreply@grappes.ai>',
        to: params.to,
        subject: params.subject,
        html: params.html,
      }),
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
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

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
    Grappes · <a href="${SITE_URL}" style="color:#c0c0c0;text-decoration:none;">grappes.ai</a>
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
<table width="560" cellpadding="0" cellspacing="0" border="0" style="max-width:560px;width:100%;font-family:'Helvetica Neue',Helvetica,Arial,sans-serif;">

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
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const greeting = params.name ? `Welcome, ${escapeHtml(params.name)}.` : 'Welcome.';
  const html = wrapEmail(greeting, `
    <p style="margin:0 0 24px;">Your account is active. Generate a complete website with AI in minutes.</p>
    <p style="margin:0 0 8px;color:#0a0a0a;font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:0.08em;">What you can do</p>
    <ul style="margin:0 0 4px;padding-left:18px;font-size:14px;line-height:2.2;color:#6b7280;">
      <li>Describe what you want and get a complete site</li>
      <li>Edit any section by describing the change</li>
      <li>Publish to your domain in one click</li>
    </ul>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Open dashboard →')}
  `);

  return sendPlatformEmail({
    to: params.to,
    subject: 'Welcome to Grappes! 🚀',
    html,
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

  return sendPlatformEmail({
    to: params.to,
    subject: `✦ ${params.siteName} is live!`,
    html,
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
  return sendPlatformEmail({ to: adminEmail, subject: `Referral payout — ${params.amount.toFixed(2)}€ for ${params.referrerEmail}`, html });
}

/**
 * Email to referrer when they earn a reward.
 */
export async function sendReferralEarnedEmail(params: {
  to: string;
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
  return sendPlatformEmail({ to: params.to, subject: `+${params.amount}€ earned from Grappes referral`, html });
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
  return sendPlatformEmail({ to: params.to, subject: `${params.siteName} — subscription cancelled`, html });
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
  return sendPlatformEmail({ to: params.to, subject: `${params.siteName} — deployment failed`, html });
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
  return sendPlatformEmail({ to: adminEmail, subject: `⚠ Domain failed: ${params.domain}`, html });
}

/**
 * Confirmation email when extra edits pack is purchased.
 */
export async function sendPaymentConfirmedEmail(params: {
  to: string;
  editsAdded: number;
  totalExtra: number;
}): Promise<{ success: boolean; id?: string; error?: string }> {
  const html = wrapEmail('Payment confirmed', `
    <p style="margin:0 0 24px;">We've added <span style="color:#0a0a0a;font-weight:700;">+${params.editsAdded} edits</span> to your account.</p>
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;margin:0 0 24px;">
      <tr>
        <td style="padding:12px 0;color:#9ca3af;border-bottom:1px solid #f0f0f0;">Edits added</td>
        <td style="padding:12px 0;color:#0a0a0a;font-weight:600;text-align:right;border-bottom:1px solid #f0f0f0;">+${params.editsAdded}</td>
      </tr>
      <tr>
        <td style="padding:12px 0;color:#9ca3af;">Total edits remaining</td>
        <td style="padding:12px 0;color:#0a0a0a;font-weight:600;text-align:right;">${params.totalExtra}</td>
      </tr>
    </table>
    ${emailBtn(`${SITE_URL}/dashboard`, 'Continue editing →')}
  `);

  return sendPlatformEmail({
    to: params.to,
    subject: `+${params.editsAdded} edits added to your account`,
    html,
  });
}
