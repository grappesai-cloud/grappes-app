// ── POST /api/kits/[id]/finalize ───────────────────────────────────────────
// Free publish — assigns a slug + stamps published_at + flips status. Allows
// the user to download/share the kit without going through Stripe. Used by
// the Brand Book + Press Kit wizards' Download/Share CTAs.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../../lib/supabase";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { json } from "../../../../lib/api-utils";
import { generateSlug } from "../../../../lib/press-kit";

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  if (!checkRateLimit(`kits-finalize:${user.id}`, 8, 60_000)) {
    return json({ error: "Too many requests." }, 429);
  }

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, status, slug")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);

  let slug = kit.slug;
  if (!slug) {
    // Generate a unique slug — retry on rare collision.
    for (let i = 0; i < 5; i++) {
      const candidate = generateSlug();
      const { data: clash } = await client
        .from("press_kits")
        .select("id")
        .eq("slug", candidate)
        .maybeSingle();
      if (!clash) { slug = candidate; break; }
    }
    if (!slug) return json({ error: "Could not allocate slug, try again." }, 503);
  }

  await client
    .from("press_kits")
    .update({
      slug,
      status: "published",
      published_at: kit.status === "published" ? undefined : new Date().toISOString(),
    })
    .eq("id", params.id);

  return json({ slug });
};
