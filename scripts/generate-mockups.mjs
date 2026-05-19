#!/usr/bin/env node
// ── One-off mockup generator ──────────────────────────────────────────────
// Generates 8 photorealistic blank product photographs via Recraft V4 raster
// and saves them to /public/mockups/<id>.jpg for use by the Brand Book
// compositing endpoint.
//
// Run: `node scripts/generate-mockups.mjs`
// Requires RECRAFT_API_KEY in .env.local (run `vercel env pull --environment=production` first).
//
// Cost: ~$0.04 per image × 8 = ~$0.32 on Recraft V4 raster pricing.
// Re-run only if you want to refresh the mockup base photos.

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.resolve(__dirname, "..", "public", "mockups");

// Load .env.local manually (no dotenv dep needed).
async function loadEnv() {
  try {
    const raw = await fs.readFile(path.resolve(__dirname, "..", ".env.local"), "utf8");
    for (const line of raw.split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*"?(.*?)"?\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
    }
  } catch {/* fine if missing */}
}

const PROMPTS = {
  business_card: 'professional product photography of a plain unbranded matte white rectangular business card, lying flat on a soft warm beige background, top-down view, studio lighting, no logo, no text, no design, centered in frame, photorealistic',
  billboard:     'professional outdoor advertising photography of a plain blank white billboard on a metal frame against a clear blue sky, no logo, no text, no graphics, eye-level view, photorealistic',
  tote_bag:      'professional product photography of a plain unbranded natural cotton canvas tote bag hanging on a soft grey background, no logo, no text, no design, front view, studio lighting, photorealistic',
  t_shirt:       'professional product photography of a plain unbranded heather grey crew-neck cotton t-shirt laid flat on a clean white surface, top-down view, no logo, no text, no design, photorealistic',
  phone_case:    'professional product photography of a plain unbranded matte black smartphone case in vertical orientation on a soft beige background, no logo, no text, no design, photorealistic',
  coffee_cup:    'professional product photography of a plain unbranded white take-away paper coffee cup with brown sleeve and white lid, sitting on a warm wooden table, no logo, no text, no design, eye-level view, photorealistic',
  signage:       'professional architectural photography of a plain blank rectangular white storefront signage panel mounted on a concrete wall, no logo, no text, no graphics, eye-level view, photorealistic',
  vehicle:       'professional product photography of a plain unbranded white delivery van parked in a clean industrial setting, side view, no logo, no text, no decals, photorealistic',
};

const RECRAFT_BASE = "https://external.api.recraft.ai/v1";

async function generateOne(id, prompt) {
  const out = path.join(PUBLIC_DIR, `${id}.jpg`);
  try { await fs.access(out); console.log(`  skip ${id} (already exists)`); return; } catch {}

  console.log(`  generating ${id}…`);
  const apiKey = process.env.RECRAFT_API_KEY;
  if (!apiKey) throw new Error("RECRAFT_API_KEY missing — run `vercel env pull --environment=production`.");

  const res = await fetch(`${RECRAFT_BASE}/images/generations`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      prompt,
      n: 1,
      response_format: "url",
      model: "recraftv3",          // raster (V4 raster endpoint is "recraftv3" → V4 of raster line per Recraft docs)
      style: "realistic_image",
      size: "1024x1024",
    }),
  });
  if (!res.ok) throw new Error(`Recraft failed (${res.status}): ${await res.text().catch(() => "")}`);
  const json = await res.json();
  const url = json.data?.[0]?.url;
  if (!url) throw new Error(`No URL in Recraft response: ${JSON.stringify(json).slice(0, 200)}`);

  const r = await fetch(url);
  if (!r.ok) throw new Error(`Download failed (${r.status})`);
  const buf = Buffer.from(await r.arrayBuffer());

  // Recraft realistic_image returns PNG by default; transcode to JPEG for size.
  const sharp = (await import("sharp")).default;
  const jpeg = await sharp(buf).jpeg({ quality: 88 }).toBuffer();
  await fs.writeFile(out, jpeg);
  console.log(`  wrote ${out} (${(jpeg.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  await loadEnv();
  await fs.mkdir(PUBLIC_DIR, { recursive: true });
  console.log("Generating Brand Book mockup bases via Recraft V4…");
  for (const [id, prompt] of Object.entries(PROMPTS)) {
    try { await generateOne(id, prompt); }
    catch (err) { console.error(`  FAILED ${id}:`, err.message); }
  }
  console.log("Done.");
}

main().catch((e) => { console.error(e); process.exit(1); });
