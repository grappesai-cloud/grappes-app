// HEIC/HEIF decoding. iPhone photos default to HEIC (HEVC-coded), which sharp's
// prebuilt binary cannot decode ("heifsave: Unsupported compression"). The file
// <input> accepts .heic, so without this every iPhone photo upload failed.
// `heic-convert` bundles libheif (wasm) and decodes HEVC reliably on any
// platform (incl. Vercel's Linux runtime). Decode to JPEG, then the normal
// sharp -> WebP path takes over.

/** Is this an HEIC/HEIF file? Checks MIME, extension, and the ISO-BMFF brand. */
export function isHeic(mime?: string | null, filename?: string | null, header?: Uint8Array): boolean {
  const m = (mime || '').toLowerCase();
  if (m === 'image/heic' || m === 'image/heif' || m === 'image/heic-sequence' || m === 'image/heif-sequence') return true;
  if (filename && /\.(heic|heif)$/i.test(filename)) return true;
  if (header && header.length >= 12) {
    // bytes 4..12 = "ftyp" + brand (heic/heix/hevc/heif/mif1/msf1)
    let s = '';
    for (let i = 4; i < 12; i++) s += String.fromCharCode(header[i]);
    if (s.startsWith('ftyp') && /heic|heix|hevc|heif|mif1|msf1/i.test(s)) return true;
  }
  return false;
}

/** Decode an HEIC/HEIF buffer to a JPEG buffer. */
export async function heicToJpeg(buffer: Buffer): Promise<Buffer> {
  const convert = (await import('heic-convert')).default;
  const out = await convert({ buffer: buffer as any, format: 'JPEG', quality: 0.92 });
  return Buffer.isBuffer(out) ? out : Buffer.from(out as ArrayBuffer);
}
