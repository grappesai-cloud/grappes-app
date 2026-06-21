// POST /api/brandbook/sign-upload — accepts a brand asset (multipart, field
// `file`), stores it in R2 server-side, returns { url, pathname }. The `kind`
// field routes it: logo | symbol | badge (images) or font (woff2/woff/ttf/otf).
// Files land in `brandbooks/<user-id>/<kind>/...`. Same-origin POST, no CORS.

import type { APIRoute } from "astro";
import { put } from "@lib/r2-blob";
import { json } from "../../../lib/api-utils";

const IMAGE_TYPES = new Set(["image/png", "image/svg+xml", "image/webp", "image/jpeg"]);
const FONT_EXT = /\.(woff2|woff|ttf|otf)$/i;
const FONT_CT: Record<string, string> = {
  woff2: "font/woff2", woff: "font/woff", ttf: "font/ttf", otf: "font/otf",
};
const IMAGE_KINDS = new Set(["logo", "symbol", "badge"]);

// Turn "MyBrand-Display.woff2" → "MyBrand Display" for a font-family label.
function familyFromName(name: string): string {
  return (name.replace(/\.[a-z0-9]+$/i, "") || "Custom")
    .replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) || "Custom";
}

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "Invalid upload." }, 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided." }, 400);

  const kind = String(form.get("kind") || "logo");
  const contentType = file.type || String(form.get("contentType") || "");
  const name = file.name || kind;

  try {
    const bytes = new Uint8Array(await file.arrayBuffer());

    if (kind === "font") {
      const m = name.match(FONT_EXT);
      if (!m) return json({ error: "Font must be .woff2, .woff, .ttf or .otf" }, 400);
      if (bytes.byteLength > 6 * 1024 * 1024) return json({ error: "Font file too large (max 6 MB)." }, 400);
      const ext = m[1].toLowerCase();
      const cleanName = name.replace(/[^a-z0-9._-]/gi, "_").slice(-80);
      const key = `brandbooks/${user.id}/fonts/${Date.now()}-${cleanName}`;
      const res = await put(key, bytes, { contentType: FONT_CT[ext] || "font/woff2" });
      return json({ url: res.url, pathname: res.pathname, family: familyFromName(name), format: ext });
    }

    if (!IMAGE_KINDS.has(kind)) return json({ error: "Unknown upload kind." }, 400);
    if (contentType && !IMAGE_TYPES.has(contentType)) {
      return json({ error: `Content type ${contentType} not allowed.` }, 400);
    }
    const cleanName = name.replace(/[^a-z0-9._-]/gi, "_").slice(-80);
    const key = `brandbooks/${user.id}/${kind}/${Date.now()}-${cleanName}`;
    const res = await put(key, bytes, { contentType });
    return json({ url: res.url, pathname: res.pathname });
  } catch (e: any) {
    console.error("[api/brandbook/sign-upload] error:", e?.message);
    return json({ error: "Upload failed." }, 500);
  }
};
