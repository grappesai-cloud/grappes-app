// R2-backed drop-in for @vercel/blob (server: put/del/head/list) + presigned
// PUT URLs for direct browser uploads (replaces @vercel/blob/client handleUpload).
// Self-hosting on Cloudflare R2 instead of Vercel Blob. Objects are namespaced
// under `grappes/` in the bucket; public assets are served from R2_PUBLIC_BASE_URL.
import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const env = (k: string): string =>
  (import.meta.env?.[k] as string | undefined) ?? process.env[k] ?? "";

const BUCKET = () => env("R2_BUCKET");
const PREFIX = "grappes/";
const PUBLIC_BASE = () => env("R2_PUBLIC_BASE_URL").replace(/\/$/, "");

export function r2Configured(): boolean {
  return Boolean(env("R2_BUCKET") && env("R2_ENDPOINT") && env("R2_ACCESS_KEY_ID") && env("R2_SECRET_ACCESS_KEY"));
}

let _client: S3Client | null = null;
function client(): S3Client {
  if (_client) return _client;
  _client = new S3Client({
    region: "auto",
    endpoint: env("R2_ENDPOINT"),
    credentials: { accessKeyId: env("R2_ACCESS_KEY_ID"), secretAccessKey: env("R2_SECRET_ACCESS_KEY") },
  });
  return _client;
}

/** Map a pathname OR a full public URL to the bucket key (prefixed). */
function keyOf(pathnameOrUrl: string): string {
  let p = pathnameOrUrl;
  const base = PUBLIC_BASE();
  if (base && p.startsWith(base)) p = p.slice(base.length).replace(/^\/+/, "");
  else p = p.replace(/^https?:\/\/[^/]+\//, "").replace(/^\/+/, "");
  return p.startsWith(PREFIX) ? p : PREFIX + p;
}
const publicUrlOf = (key: string): string => `${PUBLIC_BASE()}/${key}`;
const pathnameOf = (key: string): string => (key.startsWith(PREFIX) ? key.slice(PREFIX.length) : key);

async function toBytes(body: unknown): Promise<Uint8Array> {
  if (body == null) return new Uint8Array();
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof (body as Blob).arrayBuffer === "function") return new Uint8Array(await (body as Blob).arrayBuffer());
  return body as Uint8Array;
}

type PutResult = { url: string; downloadUrl: string; pathname: string; contentType?: string; contentDisposition: string };

/** @vercel/blob put() drop-in. */
export async function put(
  pathname: string,
  body: unknown,
  opts: { contentType?: string; access?: string; token?: string } & Record<string, unknown> = {},
): Promise<PutResult> {
  const key = keyOf(pathname);
  await client().send(new PutObjectCommand({
    Bucket: BUCKET(), Key: key, Body: await toBytes(body), ContentType: opts.contentType,
  }));
  const url = publicUrlOf(key);
  return { url, downloadUrl: url, pathname: pathnameOf(key), contentType: opts.contentType, contentDisposition: "inline" };
}

/** @vercel/blob del() drop-in (path or url, single or array). */
export async function del(input: string | string[]): Promise<void> {
  const arr = Array.isArray(input) ? input : [input];
  for (const u of arr) {
    await client().send(new DeleteObjectCommand({ Bucket: BUCKET(), Key: keyOf(u) }));
  }
}

/** @vercel/blob head() drop-in. */
export async function head(pathnameOrUrl: string): Promise<{ url: string; downloadUrl: string; pathname: string; size: number; contentType?: string; uploadedAt: Date } | null> {
  try {
    const key = keyOf(pathnameOrUrl);
    const r = await client().send(new HeadObjectCommand({ Bucket: BUCKET(), Key: key }));
    const url = publicUrlOf(key);
    return { url, downloadUrl: url, pathname: pathnameOf(key), size: Number(r.ContentLength ?? 0), contentType: r.ContentType, uploadedAt: r.LastModified ?? new Date(0) };
  } catch {
    return null;
  }
}

/** @vercel/blob list() drop-in. */
export async function list(opts: { prefix?: string; cursor?: string; limit?: number } = {}): Promise<{ blobs: Array<{ url: string; pathname: string; size: number; uploadedAt: Date }>; cursor?: string; hasMore: boolean }> {
  const prefix = opts.prefix ? PREFIX + opts.prefix.replace(/^\/+/, "") : PREFIX;
  const r = await client().send(new ListObjectsV2Command({ Bucket: BUCKET(), Prefix: prefix, ContinuationToken: opts.cursor, MaxKeys: opts.limit }));
  const blobs = (r.Contents ?? []).map((o) => ({
    url: publicUrlOf(o.Key ?? ""), pathname: pathnameOf(o.Key ?? ""), size: Number(o.Size ?? 0), uploadedAt: o.LastModified ?? new Date(0),
  }));
  return { blobs, cursor: r.NextContinuationToken, hasMore: Boolean(r.IsTruncated) };
}

/** Presigned PUT URL for direct browser uploads (replaces handleUpload). */
export async function presignPut(pathname: string, contentType?: string, expiresSec = 600): Promise<{ uploadUrl: string; publicUrl: string; pathname: string }> {
  const key = keyOf(pathname);
  const uploadUrl = await getSignedUrl(client(), new PutObjectCommand({ Bucket: BUCKET(), Key: key, ContentType: contentType }), { expiresIn: expiresSec });
  return { uploadUrl, publicUrl: publicUrlOf(key), pathname: pathnameOf(key) };
}
