// ── POST /api/brandbook/sign-upload — Vercel Blob token for the brand logo ──
// The wizard uploads the user's existing logo (transparent PNG or SVG) before
// generation. Files land in `brandbooks/<user-id>/logo/...`.

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
          allowedContentTypes: ["image/png", "image/svg+xml", "image/webp", "image/jpeg"],
          maximumSizeInBytes: 10 * 1024 * 1024,
          tokenPayload: JSON.stringify({ userId: user.id, scope: "brandbook-logo" }),
          addRandomSuffix: true,
          pathname: `brandbooks/${user.id}/logo/${cleanName}`,
        };
      },
      onUploadCompleted: async () => { /* no-op */ },
    });
    return new Response(JSON.stringify(res), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    console.error("[api/brandbook/sign-upload] error:", e.message);
    return json({ error: "Upload setup failed." }, 500);
  }
};
