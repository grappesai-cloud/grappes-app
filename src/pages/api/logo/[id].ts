// ── DELETE /api/logo/[id] — remove a Logo Lab logo ───────────────────────
// Only the owner can delete. Blob assets get a best-effort delete too — if
// that fails we still drop the row.

import type { APIRoute } from "astro";
import { del } from '@lib/r2-blob';
import { createAdminClient } from "../../../lib/supabase";
import { json } from "../../../lib/api-utils";

export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  const client = createAdminClient();
  const { data: logo } = await client
    .from("user_logos")
    .select("id, user_id, png_url, svg_url")
    .eq("id", params.id)
    .maybeSingle();
  if (!logo || logo.user_id !== user.id) return json({ error: "Not found" }, 404);

  // Best-effort R2 cleanup — not critical, the row delete is what matters.
  const urls = [logo.png_url, logo.svg_url].filter(Boolean) as string[];
  if (urls.length) {
    try { await del(urls); } catch (e) { console.warn("[logo delete] blob cleanup failed:", e); }
  }

  const { error } = await client.from("user_logos").delete().eq("id", params.id);
  if (error) {
    console.error("[logo delete] db error:", error);
    return json({ error: "Could not delete." }, 500);
  }
  return json({ ok: true });
};
