// ── GET /api/logo/[id]/download?format=png|svg ───────────────────────────
// Same-origin download proxy. The blob files live on *.blob.vercel-storage.com
// and browsers ignore the `download` attribute on cross-origin links, so a
// plain <a download href={blob_url}> just opens the image instead of saving
// it. We stream the file through our origin with Content-Disposition:
// attachment so the browser actually downloads it (desktop + mobile).

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../../lib/supabase";
import { json } from "../../../../lib/api-utils";

export const GET: APIRoute = async ({ locals, params, url }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  const format = url.searchParams.get("format") === "svg" ? "svg" : "png";

  const client = createAdminClient();
  const { data: logo } = await client
    .from("user_logos")
    .select("id, user_id, name, png_url, svg_url")
    .eq("id", params.id)
    .maybeSingle();
  if (!logo || logo.user_id !== user.id) return json({ error: "Not found" }, 404);

  const fileUrl = format === "svg" ? logo.svg_url : logo.png_url;
  if (!fileUrl) return json({ error: `No ${format.toUpperCase()} for this logo.` }, 404);

  const upstream = await fetch(fileUrl);
  if (!upstream.ok || !upstream.body) {
    console.error("[logo download] blob fetch failed:", upstream.status, fileUrl);
    return json({ error: "Could not fetch the file." }, 502);
  }

  // Safe ASCII filename — strip anything exotic, fall back to "logo".
  const safeName = (logo.name || "logo").replace(/[^a-zA-Z0-9 _-]/g, "").trim() || "logo";

  return new Response(upstream.body, {
    status: 200,
    headers: {
      "Content-Type": format === "svg" ? "image/svg+xml" : "image/png",
      "Content-Disposition": `attachment; filename="${safeName}.${format}"`,
      "Cache-Control": "private, no-store",
    },
  });
};
