// ── POST /api/logo/generate — Logo Lab standalone generation ────────────
// Same Recraft V4 Vector pipeline as the press-kit logo endpoint, but the
// resulting SVG + PNG live in user_logos (NOT attached to a press_kits row).
// Rate-limited 3/min/user to bound API cost.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../lib/supabase";
import { checkRateLimit } from "../../../lib/rate-limit";
import { json } from "../../../lib/api-utils";
import { generateLogo, type GenerateLogoInput } from "../../../lib/logo-gen";
import { consumeCredit, refundCredit } from "../../../lib/credits";

export const maxDuration = 90;

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  if (!checkRateLimit(`logo-gen:${user.id}`, 3, 60_000)) {
    return json({ error: "Slow down, 3 logos per minute max." }, 429);
  }

  let body: {
    brandName?: string;
    description?: string;
    style?: string;
    mood?: string;
    primaryColor?: string;
    referenceImages?: string[];
    logoType?: "icon" | "wordmark" | "combination";
  } = {};
  try { body = await request.json(); } catch {}

  const brandName = (body.brandName ?? "").trim();
  if (!brandName) return json({ error: "Brand name is required." }, 400);

  const description = (body.description ?? "").trim();
  const referenceImages = Array.isArray(body.referenceImages)
    ? body.referenceImages
        .filter((u): u is string => typeof u === "string" && /^https?:\/\//.test(u))
        .slice(0, 3)
    : [];
  const logoType: "icon" | "wordmark" | "combination" =
    body.logoType === "wordmark" || body.logoType === "combination" ? body.logoType : "icon";
  const mood = (body.mood ?? "").trim() || undefined;
  const style = (body.style ?? "").trim() || undefined;
  const primaryColor = (body.primaryColor ?? "").trim() || undefined;

  if (logoType === "icon" && description.length < 4 && referenceImages.length === 0) {
    return json({ error: "Describe the icon or add a reference photo (at least one)." }, 400);
  }

  // Consume 1 Logo credit (admin-granted, white-label). Refunded if generation fails.
  if ((await consumeCredit(user.id, "logo")) === null) {
    return json({ error: "Nu mai ai credite Logo.", code: "no_credits" }, 402);
  }

  const input: GenerateLogoInput = {
    assetPrefix: `logos/${user.id}`,
    description: description || `Logo for ${brandName}`,
    primaryColor,
    style,
    referenceImages: referenceImages.length > 0 ? referenceImages : undefined,
    brandName,
    logoType,
    mood,
  };

  try {
    const result = await generateLogo(input);

    const client = createAdminClient();
    const { data, error } = await client
      .from("user_logos")
      .insert({
        user_id: user.id,
        name: brandName,
        prompt: description || null,
        png_url: result.pngUrl,
        svg_url: result.svgUrl || null,
        logo_type: logoType,
        mood: mood ?? null,
        description: description || null,
        style_keywords: style ?? null,
        primary_color: primaryColor ?? null,
        reference_images: referenceImages,
      })
      .select("id, png_url, svg_url")
      .single();

    if (error || !data) {
      console.error("[api/logo/generate] insert failed:", error);
      await refundCredit(user.id, "logo");
      return json({ error: "Could not save logo." }, 500);
    }

    return json({ id: data.id, png_url: data.png_url, svg_url: data.svg_url });
  } catch (e: any) {
    console.error("[api/logo/generate] pipeline failed:", e);
    await refundCredit(user.id, "logo");
    return json({ error: "Logo generation failed: " + (e?.message ?? "unknown") }, 500);
  }
};
