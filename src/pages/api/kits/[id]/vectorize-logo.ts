// ── POST /api/kits/[id]/vectorize-logo ─────────────────────────────────────
// Vectorizes the kit's currently-uploaded raster logo (PNG/JPG) into SVG and
// writes both the original URL (kept) + logo_svg URL back to kit.assets.
// Triggered from the editor right after a user uploads a raster logo, so the
// "Download SVG" button can appear without forcing them to use AI generation.

import type { APIRoute } from "astro";
import { createAdminClient } from "../../../../lib/supabase";
import { checkRateLimit } from "../../../../lib/rate-limit";
import { json } from "../../../../lib/api-utils";
import { vectorize } from "@neplex/vectorizer";
import sharp from "sharp";
import { put } from "@vercel/blob";

const ColorMode_Color = 0;
const Hierarchical_Stacked = 0;
const PathSimplifyMode_Spline = 2;

export const maxDuration = 60;
export const POST: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!params.id) return json({ error: "missing id" }, 400);

  if (!checkRateLimit(`kits-vectorize:${user.id}`, 5, 60_000)) {
    return json({ error: "Slow down." }, 429);
  }

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, assets")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return json({ error: "Not found" }, 404);

  const logoUrl = (kit.assets as any)?.logo as string | undefined;
  if (!logoUrl) return json({ error: "No logo to vectorize." }, 400);

  // Skip SVGs — already vector.
  if (logoUrl.toLowerCase().endsWith(".svg")) {
    const update = { assets: { ...(kit.assets as any), logo_svg: logoUrl } };
    await client.from("press_kits").update(update).eq("id", params.id);
    return json({ svgUrl: logoUrl });
  }

  const token = process.env.BLOB_READ_WRITE_TOKEN ?? import.meta.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return json({ error: "Blob token missing." }, 500);

  try {
    const res = await fetch(logoUrl);
    if (!res.ok) return json({ error: "Logo fetch failed." }, 502);
    const arr = await res.arrayBuffer();

    // Normalize to PNG (vectorizer accepts a Buffer of PNG bytes).
    const png = await sharp(Buffer.from(arr))
      .resize({ width: 1024, withoutEnlargement: true })
      .png()
      .toBuffer();

    const svg = await vectorize(png, {
      colorMode: ColorMode_Color as any,
      colorPrecision: 6,
      filterSpeckle: 6,
      spliceThreshold: 45,
      cornerThreshold: 60,
      hierarchical: Hierarchical_Stacked as any,
      mode: PathSimplifyMode_Spline as any,
      layerDifference: 16,
      lengthThreshold: 5,
      maxIterations: 12,
      pathPrecision: 5,
    });

    const ts = Date.now();
    const svgBlob = await put(`kits/${params.id}/logo-uploaded-${ts}.svg`, svg, {
      access: "public",
      contentType: "image/svg+xml",
      token,
    });

    const update = {
      assets: { ...(kit.assets as any), logo_svg: svgBlob.url },
      updated_at: new Date().toISOString(),
    };
    await client.from("press_kits").update(update).eq("id", params.id);

    return json({ svgUrl: svgBlob.url });
  } catch (e: any) {
    console.error("[vectorize-logo] failed:", e);
    return json({ error: "Vectorization failed: " + e.message }, 500);
  }
};
