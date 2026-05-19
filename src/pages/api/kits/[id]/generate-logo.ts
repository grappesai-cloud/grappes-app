// ── POST /api/kits/[id]/generate-logo ──────────────────────────────────────
// AI logo generation for a press kit:
//   1. OpenAI gpt-image-1 generates a flat-vector mark on white bg
//   2. sharp pipeline makes white transparent
//   3. @neplex/vectorizer traces it to SVG
// Saves both pngUrl + svgUrl to kit.assets.logo / kit.assets.logo_svg.
// Rate-limited 3/min/user, lifetime cap 10/kit to bound OpenAI cost.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../../lib/supabase";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { json } from "../../../../lib/api-utils";
import { generateLogo, type GenerateLogoInput } from "../../../../lib/logo-gen";
import { extractPaletteFromLogo } from "../../../../lib/press-kit";

export const maxDuration = 90;
export const POST: APIRoute = async ({ locals, params, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  if (!checkRateLimit(`kits-genlogo:${user.id}`, 3, 60_000)) {
    return json({ error: "Slow down, 3 logos per minute max." }, 429);
  }

  let body: { description?: string; primaryColor?: string; style?: string; referenceImages?: string[] } = {};
  try { body = await request.json(); } catch {}
  const description = (body.description ?? "").trim();
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages.filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u)).slice(0, 3)
    : [];
  if (description.length < 4) {
    return json({ error: "Describe the brand in a sentence (at least 4 characters)." }, 400);
  }

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, name, assets, palette")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);

  // Pull palette colors so the generator stays on brand. Skip when palette is
  // still the default (untouched by user, no logo extraction yet).
  const pal = (kit.palette as any) ?? {};
  const paletteColors: string[] = [];
  if (pal.primary && pal.primary !== "#0a0a0a") paletteColors.push(pal.primary);
  if (pal.accent && pal.accent !== "#22d3ee") paletteColors.push(pal.accent);
  if (pal.secondary && pal.secondary !== "#262626") paletteColors.push(pal.secondary);

  // Lifetime cap per kit — count previous logos in the assets folder via the
  // simple "logo_generation_count" sidecar (stored in assets.logo_generations).
  const prevCount = (kit.assets as any)?.logo_generations ?? 0;
  if (prevCount >= 10) {
    return json({ error: "Generation limit reached for this kit (10 max)." }, 402);
  }

  const input: GenerateLogoInput = {
    kitId: params.id,
    description,
    primaryColor: body.primaryColor,
    paletteColors: paletteColors.length > 0 ? paletteColors : undefined,
    style: body.style,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
  };

  try {
    const result = await generateLogo(input);

    // Extract palette from the new logo unless user has manually overridden it
    const newAssets = {
      ...(kit.assets as any),
      logo: result.pngUrl,
      logo_svg: result.svgUrl || undefined,
      logo_generations: prevCount + 1,
    };

    const update: Record<string, unknown> = {
      assets: newAssets,
      updated_at: new Date().toISOString(),
    };

    // Only auto-extract palette on first generation (don't override later)
    if (prevCount === 0) {
      const extracted = await extractPaletteFromLogo(result.pngUrl);
      if (extracted) update.palette = extracted;
    }

    await client.from("press_kits").update(update).eq("id", params.id);

    return json({
      pngUrl: result.pngUrl,
      svgUrl: result.svgUrl,
      remaining: 10 - (prevCount + 1),
    });
  } catch (e: any) {
    console.error("[generate-logo] pipeline failed:", e);
    return json({ error: "Logo generation failed: " + e.message }, 500);
  }
};
