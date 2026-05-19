// ── GET /api/kits/[id]/mockup/[mockupId] ─────────────────────────────────────
// Composites the kit's logo onto a Brand Book mockup base image (tote bag,
// billboard, phone case, etc.) and returns a JPEG. Results are cached to
// Vercel Blob keyed on the logo URL so repeat renders are instant.

import type { APIRoute } from "astro";
import crypto from "node:crypto";
import sharp from "sharp";
import { put, head } from "@vercel/blob";
import { createAdminClient } from "../../../../../lib/supabase";
import { MOCKUPS, isMockupId } from "../../../../../lib/mockups";

export const maxDuration = 30;

export const GET: APIRoute = async ({ locals, params }) => {
  const user = locals.user;
  if (!user) return new Response("Sign in first.", { status: 401 });
  if (!params.id || !params.mockupId) return new Response("Missing param.", { status: 400 });
  if (!isMockupId(params.mockupId)) return new Response("Unknown mockup.", { status: 404 });

  const client = createAdminClient();
  const { data: kit } = await client
    .from("press_kits")
    .select("id, user_id, assets")
    .eq("id", params.id)
    .maybeSingle();
  if (!kit || kit.user_id !== user.id) return new Response("Not found", { status: 404 });

  const logoUrl = (kit.assets as any)?.logo as string | undefined;
  const template = MOCKUPS[params.mockupId];

  // Logo hash for cache key (8 hex chars is plenty here).
  const logoHash = logoUrl
    ? crypto.createHash("sha1").update(logoUrl).digest("hex").slice(0, 10)
    : "nologo";
  const blobKey = `kits/${kit.id}/mockup-${params.mockupId}-${logoHash}.jpg`;

  // Probe Blob cache. `head` throws when key is missing — use a try/catch.
  try {
    const meta = await head(blobKey);
    if (meta?.url) {
      const r = await fetch(meta.url);
      if (r.ok) {
        return new Response(await r.arrayBuffer(), {
          headers: {
            "Content-Type": "image/jpeg",
            "Cache-Control": "public, max-age=3600",
          },
        });
      }
    }
  } catch { /* miss → render */ }

  // Load base mockup (always rasterised through sharp).
  const baseBuf = await loadBase(template.base_url, template.width, template.height);

  // No logo yet? Just return the base unchanged so the wizard can still preview.
  if (!logoUrl) {
    const jpeg = await sharp(baseBuf).jpeg({ quality: 88 }).toBuffer();
    return jpegResponse(jpeg);
  }

  // Pull the logo bytes.
  let logoBytes: Buffer;
  try {
    const r = await fetch(logoUrl);
    if (!r.ok) throw new Error(`logo fetch ${r.status}`);
    logoBytes = Buffer.from(await r.arrayBuffer());
  } catch (err) {
    console.error("[mockup] logo fetch failed", err);
    const jpeg = await sharp(baseBuf).jpeg({ quality: 88 }).toBuffer();
    return jpegResponse(jpeg);
  }

  // SVG logos go through sharp with a density to rasterise crisply.
  const isSvg = logoUrl.toLowerCase().endsWith(".svg") || logoBytes.slice(0, 256).toString("utf8").includes("<svg");
  let logoImg = sharp(logoBytes, isSvg ? { density: 300 } : undefined);

  // Fit logo inside region while preserving aspect ratio.
  const { x, y, w, h } = template.logo_region;
  logoImg = logoImg.resize({ width: w, height: h, fit: "inside", background: { r: 0, g: 0, b: 0, alpha: 0 } });

  // Optional retint (e.g. white logo on a black phone case).
  let logoResized = await logoImg.png().toBuffer();
  const tint = template.logo_tint;
  if (tint === "white" || tint === "black") {
    logoResized = await sharp(logoResized)
      .ensureAlpha()
      .composite([{
        input: Buffer.from([
          tint === "white" ? 255 : 0,
          tint === "white" ? 255 : 0,
          tint === "white" ? 255 : 0,
          255,
        ]),
        raw: { width: 1, height: 1, channels: 4 },
        tile: true,
        blend: "in",
      }])
      .png()
      .toBuffer();
  }

  // Center within region.
  const meta = await sharp(logoResized).metadata();
  const lw = meta.width ?? w;
  const lh = meta.height ?? h;
  const left = Math.max(0, Math.round(x + (w - lw) / 2));
  const top  = Math.max(0, Math.round(y + (h - lh) / 2));

  const composed = await sharp(baseBuf)
    .composite([{ input: logoResized, left, top, blend: template.blend ?? "over" }])
    .jpeg({ quality: 88 })
    .toBuffer();

  // Best-effort cache.
  try {
    await put(blobKey, composed, { access: "public", contentType: "image/jpeg" });
  } catch (err) {
    console.warn("[mockup] blob cache write failed", err);
  }

  return jpegResponse(composed);
};

function jpegResponse(buf: Buffer): Response {
  return new Response(buf, {
    headers: {
      "Content-Type": "image/jpeg",
      "Cache-Control": "public, max-age=3600",
    },
  });
}

async function loadBase(publicPath: string, width: number, height: number): Promise<Buffer> {
  // Resolve from /public. In Astro, files in /public are served as static
  // assets and not bundled — we read from disk.
  const fs = await import("node:fs/promises");
  const path = await import("node:path");
  const filePath = path.resolve(process.cwd(), "public", publicPath.replace(/^\//, ""));
  const raw = await fs.readFile(filePath);
  // SVG → raster via sharp.
  if (filePath.toLowerCase().endsWith(".svg")) {
    return await sharp(raw, { density: 200 }).resize(width, height).png().toBuffer();
  }
  return raw;
}
