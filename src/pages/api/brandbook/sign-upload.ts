// POST /api/brandbook/sign-upload — accepts the brand logo (multipart, field
// `file`), stores it in R2 server-side, returns { url, pathname }. Files land in
// `brandbooks/<user-id>/logo/...`. Same-origin POST: no bucket CORS needed.

import type { APIRoute } from "astro";
import { put } from "@lib/r2-blob";
import { json } from "../../../lib/api-utils";

const ALLOWED = new Set(["image/png", "image/svg+xml", "image/webp", "image/jpeg"]);

export const POST: APIRoute = async ({ locals, request }) => {
  const user = locals.user;
  if (!user) return json({ error: "Sign in first." }, 401);

  let form: FormData;
  try { form = await request.formData(); } catch { return json({ error: "Invalid upload." }, 400); }
  const file = form.get("file");
  if (!(file instanceof File)) return json({ error: "No file provided." }, 400);

  const contentType = file.type || String(form.get("contentType") || "");
  if (contentType && !ALLOWED.has(contentType)) {
    return json({ error: `Content type ${contentType} not allowed.` }, 400);
  }
  try {
    const cleanName = (file.name || "logo").replace(/[^a-z0-9._-]/gi, "_").slice(-80);
    const key = `brandbooks/${user.id}/logo/${Date.now()}-${cleanName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await put(key, bytes, { contentType });
    return json({ url: res.url, pathname: res.pathname });
  } catch (e: any) {
    console.error("[api/brandbook/sign-upload] error:", e.message);
    return json({ error: "Upload failed." }, 500);
  }
};
