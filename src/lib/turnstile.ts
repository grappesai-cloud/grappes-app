// Cloudflare Turnstile server-side verification.
// Fails open (returns true) when TURNSTILE_SECRET_KEY is not configured,
// so local dev and preview environments keep working without setup.

export async function verifyTurnstile(token: string | null, ip: string): Promise<boolean> {
  const secret = import.meta.env.TURNSTILE_SECRET_KEY;
  if (!secret) return true;
  if (!token) return false;

  try {
    const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ secret, response: token, remoteip: ip }),
    });
    const data = await res.json() as { success?: boolean };
    return data.success === true;
  } catch (e) {
    console.warn('[turnstile] verification failed:', e);
    return false;
  }
}

export function turnstileSiteKey(): string | undefined {
  return import.meta.env.PUBLIC_TURNSTILE_SITE_KEY;
}
