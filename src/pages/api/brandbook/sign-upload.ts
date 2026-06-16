// ── POST /api/brandbook/sign-upload — presigned R2 PUT URL for the brand logo ──
// The wizard uploads the user's existing logo (PNG/SVG) before generation.
// Files land in `brandbooks/<user-id>/logo/...` in R2.

import type { APIRoute } from "astro";
import { presignPut } from "@lib/r2-blob";
import { json } from "../../../lib/api-utils";

const ALLOWED = new Set(["image/png", "image/svg+xml", "image/webp", "image/jpeg"]);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  const { pathname, contentType } = (await request.json().catch(() => ({}))) as {
    pathname?: string; contentType?: string;
  };
  if (contentType && !ALLOWED.has(contentType)) {
    return json({ error: `Content type ${contentType} not allowed.` }, 400);
  }
  try {
    const cleanName = (pathname?.split("/").pop() || "logo").replace(/[^a-z0-9._-]/gi, "_").slice(-80);
    const key = `brandbooks/${user.id}/logo/${Date.now()}-${cleanName}`;
    const res = await presignPut(key, contentType);
    return json(res);
  } catch (e: any) {
    console.error("[api/brandbook/sign-upload] error:", e.message);
    return json({ error: "Upload setup failed." }, 500);
  }
};
