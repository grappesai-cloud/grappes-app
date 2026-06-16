// POST /api/logo/sign-upload — accepts a Logo Lab reference image (multipart,
// field `file`), stores it in R2 server-side, returns { url, pathname }.
// References land in `logos/<user-id>/refs/...`. Same-origin POST: no CORS.

import type { APIRoute } from "astro";
import { put } from "@lib/r2-blob";
import { json } from "../../../lib/api-utils";

const ALLOWED = new Set(["image/jpeg", "image/png", "image/svg+xml", "image/webp"]);

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
    const cleanName = (file.name || "ref").replace(/[^a-z0-9._-]/gi, "_").slice(-80);
    const key = `logos/${user.id}/refs/${Date.now()}-${cleanName}`;
    const bytes = new Uint8Array(await file.arrayBuffer());
    const res = await put(key, bytes, { contentType });
    return json({ url: res.url, pathname: res.pathname });
  } catch (e: any) {
    console.error("[api/logo/sign-upload] error:", e.message);
    return json({ error: "Upload failed." }, 500);
  }
};
