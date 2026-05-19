// ── POST /api/kits — create a new draft press kit ─────────────────────────
// Drafts are free. Stripe only fires when the user clicks Publish.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../lib/supabase";
import { checkRateLimit } from "../../../lib/rate-limit";
import { json } from "../../../lib/api-utils";
import { defaultFontsFor, DEFAULT_PALETTE, type KitType } from "../../../lib/press-kit";

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  if (!checkRateLimit(`kits-create:${user.id}`, 10, 60_000)) {
    return json({ error: "Too many requests." }, 429);
  }

  let body: { name?: string; kit_type?: KitType; kit_type_other?: string } = {};
  try { body = await request.json(); } catch { /* allow empty body */ }

  const name = (body.name ?? "").trim() || "Untitled press kit";
  const kit_type = (body.kit_type ?? "other") as KitType;
  // When the user picks "Other" we capture the free-text label and seed it as
  // an initial tagline so step 2 already shows something meaningful. The user
  // can edit or clear it on the next screen.
  const taglineSeed =
    kit_type === "other" && body.kit_type_other
      ? body.kit_type_other.trim().slice(0, 60)
      : null;

  const client = createAdminClient();
  const { data, error } = await client
    .from("press_kits")
    .insert({
      user_id: user.id,
      name,
      kit_type,
      tagline: taglineSeed,
      palette: DEFAULT_PALETTE,
      fonts: defaultFontsFor(kit_type),
    })
    .select("id")
    .single();

  if (error || !data) {
    console.error("[kits/create] insert error:", error);
    return json({ error: "Could not create kit." }, 500);
  }

  return json({ id: data.id });
};
