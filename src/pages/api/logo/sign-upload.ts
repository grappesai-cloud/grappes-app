// ── POST /api/logo/sign-upload — Vercel Blob upload tokens for Logo Lab ──
// Used by the conversational flow to upload reference photos before
// generation. References land in `logos/<user-id>/refs/...` so they're
// scoped per user without needing a kit row.

import type { APIRoute } from "astro";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { json } from "../../../lib/api-utils";

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  const body = (await request.json()) as HandleUploadBody;
  try {
    const res = await handleUpload({
      body,
      request: request as unknown as Request,
      onBeforeGenerateToken: async (pathname) => {
        const cleanName = pathname.replace(/[^a-z0-9._-]/gi, "_").slice(-80);
        return {
          allowedContentTypes: ["image/jpeg", "image/png", "image/svg+xml", "image/webp"],
          maximumSizeInBytes: 20 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: user.id, scope: "logo-ref" }),
          addRandomSuffix: true,
          pathname: `logos/${user.id}/refs/${cleanName}`,
        };
      },
      onUploadCompleted: async () => { /* no-op */ },
    });
    return new Response(JSON.stringify(res), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    console.error("[api/logo/sign-upload] error:", e.message);
    return json({ error: "Upload setup failed." }, 500);
  }
};
