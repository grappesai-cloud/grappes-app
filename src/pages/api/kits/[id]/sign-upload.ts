// ── POST /api/kits/[id]/sign-upload — issue Vercel Blob upload tokens ──
// Client uploads directly to Vercel Blob via @vercel/blob/client.
// We authorize each token request to make sure it's the kit owner.

import type { APIRoute } from "astro";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { createAdminClient } from "../../../../lib/supabase";
import { json } from "../../../../lib/api-utils";

export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  // Ownership check
  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);

  const body = (await request.json()) as HandleUploadBody;
  try {
    const res = await handleUpload({
      body,
      request: request as unknown as Request,
      onBeforeGenerateToken: async (pathname) => {
        const cleanName = pathname.replace(/[^a-z0-9._-]/gi, "_").slice(-80);
        return {
          allowedContentTypes: [
            "image/jpeg", "image/png", "image/svg+xml", "image/webp", "image/gif",
            "video/mp4", "video/quicktime", "video/webm",
            "application/pdf",
          ],
          maximumSizeInBytes: 100 * 1024 * 1024,
          tokenPayload: JSON.stringify({ kitId: params.id, userId: user.id }),
          addRandomSuffix: true,
          pathname: `kits/${params.id}/${cleanName}`,
        };
      },
      onUploadCompleted: async () => {
        // Kit row gets updated by the client via PATCH after the upload URL is known.
      },
    });
    return new Response(JSON.stringify(res), { headers: { "content-type": "application/json" } });
  } catch (e: any) {
    console.error("[kits/sign-upload] error:", e.message);
    return json({ error: "Upload setup failed." }, 500);
  }
};
