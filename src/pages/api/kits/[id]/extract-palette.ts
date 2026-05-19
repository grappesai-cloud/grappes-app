// ── POST /api/kits/[id]/extract-palette ────────────────────────────────────
// Force re-extraction of the kit's color palette from its current logo.
// Used by the brand-book wizard's "Re-extract from logo" button so the user
// can refresh after fixing the logo or when the kit's palette is stuck at
// stale defaults from before the SVG-aware extractor shipped.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../../lib/supabase";
import { json } from "../../../../lib/api-utils";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { extractPaletteFromLogo, fillPalette, type Palette } from "../../../../lib/press-kit";

export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  if (!checkRateLimit(`kits-extract:${user.id}`, 6, 60_000)) {
    return json({ error: "Slow down." }, 429);
  }

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, assets, palette")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);

  const logoUrl = (kit.assets as any)?.logo;
  if (!logoUrl) return json({ error: "No logo uploaded for this kit yet." }, 400);

  const extracted: Palette | null = await extractPaletteFromLogo(logoUrl);
  if (!extracted) {
    // Fall back to a fully-derived palette from whatever primary the kit
    // already has, so the user at least gets out of the stale-defaults state.
    const fallback = fillPalette({ primary: (kit.palette as any)?.primary });
    await client.from("press_kits").update({ palette: fallback, palette_named: paletteToNamed(fallback) }).eq("id", params.id);
    return json({ palette: fallback, palette_named: paletteToNamed(fallback), fallback: true });
  }

  const named = paletteToNamed(extracted);
  await client.from("press_kits").update({ palette: extracted, palette_named: named }).eq("id", params.id);
  return json({ palette: extracted, palette_named: named });
};

function paletteToNamed(p: Palette): Array<{ hex: string; label: string; role: string }> {
  return [
    { hex: p.primary,   label: "Primary",    role: "primary" },
    { hex: p.secondary, label: "Secondary",  role: "secondary" },
    { hex: p.accent,    label: "Accent",     role: "accent" },
    { hex: p.bg,        label: "Background", role: "background" },
    { hex: p.text,      label: "Text",       role: "text" },
  ];
}
