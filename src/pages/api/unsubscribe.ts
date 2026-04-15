import type { APIRoute } from 'astro';
import { createHmac, timingSafeEqual } from 'node:crypto';

function verifyUnsubToken(userId: string, token: string): boolean {
  const secret = import.meta.env.UNSUB_SECRET || 'default-unsub-secret';
  const expected = createHmac('sha256', secret).update(userId).digest('hex');
  if (token.length !== expected.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
}

// Support both GET (link click) and POST (one-click RFC 8058)
export const GET: APIRoute = async ({ url }) => {
  const token = url.searchParams.get('token');
  const uid = url.searchParams.get('uid');

  if (!token || !uid) {
    return new Response(unsubPage('Invalid link', 'The unsubscribe link is invalid or expired.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  if (!verifyUnsubToken(uid, token)) {
    return new Response(unsubPage('Invalid link', 'The unsubscribe link is invalid or has been tampered with.'), {
      status: 403,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  try {
    const { createAdminClient } = await import('../../lib/supabase');
    const client = createAdminClient();
    await client.from('users').update({ marketing_opt_out: true }).eq('id', uid);

    return new Response(unsubPage('Unsubscribed', 'You have been unsubscribed from marketing emails. You will still receive important account notifications (password resets, payment confirmations, etc.).'), {
      status: 200,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  } catch (e: any) {
    console.error('[unsubscribe] Error:', e);
    return new Response(unsubPage('Error', 'Something went wrong. Please try again or contact support@grappes.dev.'), {
      status: 500,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }
};

export const POST: APIRoute = async ({ request, url }) => {
  // RFC 8058 one-click unsubscribe — body is "List-Unsubscribe=One-Click"
  const body = await request.text().catch(() => '');
  const token = url.searchParams.get('token');
  const uid = url.searchParams.get('uid');

  if (!token || !uid || !verifyUnsubToken(uid, token)) {
    return new Response('Invalid', { status: 403 });
  }

  try {
    const { createAdminClient } = await import('../../lib/supabase');
    const client = createAdminClient();
    await client.from('users').update({ marketing_opt_out: true }).eq('id', uid);
    return new Response('OK', { status: 200 });
  } catch {
    return new Response('Error', { status: 500 });
  }
};

function unsubPage(title: string, message: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title} — Grappes</title>
  <link href="https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&display=swap" rel="stylesheet">
  <style>
    * { margin:0; padding:0; box-sizing:border-box; }
    body { font-family:'DM Sans',sans-serif; background:#fff; color:#0a0a0a; display:flex; align-items:center; justify-content:center; min-height:100vh; padding:24px; }
    .card { max-width:440px; text-align:center; }
    .card img { width:120px; margin-bottom:32px; }
    .card h1 { font-size:24px; font-weight:600; margin-bottom:12px; letter-spacing:-0.03em; }
    .card p { font-size:15px; line-height:1.7; color:#6b7280; margin-bottom:24px; }
    .card a { color:#06bfdd; text-decoration:none; font-weight:500; }
    .card a:hover { text-decoration:underline; }
  </style>
</head>
<body>
  <div class="card">
    <img src="https://grappes.dev/assets/grappes/logo.png" alt="Grappes">
    <h1>${title}</h1>
    <p>${message}</p>
    <a href="https://grappes.dev/dashboard/account">Go to account settings</a>
  </div>
</body>
</html>`;
}
