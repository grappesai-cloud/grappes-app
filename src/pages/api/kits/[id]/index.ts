// ── PATCH /api/kits/[id] — partial update of a draft kit ──────────────────
// Only the owner can patch. Published kits still allow content edits (kit
// stays paid, public URL keeps working) but slug + status can't be changed.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../../lib/supabase";
import { json } from "../../../../lib/api-utils";
import { extractPaletteFromLogo, type Palette, type Fonts } from "../../../../lib/press-kit";

const UPDATABLE_FIELDS = new Set([
  "kit_type", "mode", "name", "tagline", "bio_short", "bio_long",
  "contact_email", "contact_phone", "contact_other",
  "palette", "fonts", "links", "stats", "assets", "press", "awards",
  // DENY-style additions (PR 2)
  "role", "overview_intro", "key_highlights", "shared_stage",
  "career", "big_stats", "booking",
  // Brand Book additions (PR 3)
  "industry", "voice_keywords", "voice_paragraph",
  "palette_named", "applications", "donts",
]);

const VALID_MODES = new Set(["press_kit", "brand_book"]);

export const PATCH: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  let body: Record<string, unknown> = {};
  try { body = await request.json(); } catch { return json({ error: "Bad JSON" }, 400); }

  const client = createAdminClient();

  // Verify ownership
  const { data: existing } = await client
    .from("press_kits")
    .select("id, user_id, palette, assets")
    .eq("id", params.id)
    .maybeSingle();
  if (!existing || existing.user_id !== user.id) return json({ error: "Not found" }, 404);

  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  for (const [key, val] of Object.entries(body)) {
    if (!UPDATABLE_FIELDS.has(key)) continue;
    if (key === "mode" && (typeof val !== "string" || !VALID_MODES.has(val))) continue;
    update[key] = val;
  }

  // ── Auto-extract palette when a new logo is uploaded ──────────────────
  // Only if the caller didn't simultaneously override the palette manually.
  const oldLogo = (existing.assets as any)?.logo as string | undefined;
  const newAssets = update.assets as { logo?: string } | undefined;
  const newLogo = newAssets?.logo;
  const paletteAlreadyTouched = "palette" in update;
  if (newLogo && newLogo !== oldLogo && !paletteAlreadyTouched) {
    const extracted = await extractPaletteFromLogo(newLogo);
    if (extracted) update.palette = extracted;
  }

  const { error } = await client
    .from("press_kits")
    .update(update)
    .eq("id", params.id);

  if (error) {
    console.error("[kits/patch] update error:", error);
    return json({ error: "Update failed." }, 500);
  }

  return json({ ok: true });
};

export const DELETE: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  const client = createAdminClient();
  // Only delete drafts. Published kits stay around (they have a public URL).
  const { error } = await client
    .from("press_kits")
    .delete()
    .eq("id", params.id)
    .eq("user_id", user.id)
    .eq("status", "draft");

  if (error) return json({ error: "Delete failed." }, 500);
  return json({ ok: true });
};
