// Drop-in replacement for @vercel/blob/client's `upload()`, backed by Cloudflare
// R2 presigned PUT URLs. The sign endpoint (handleUploadUrl) returns
// { uploadUrl, publicUrl, pathname }; we PUT the file straight to R2 and return
// a { url, pathname } object shaped like the Vercel Blob result.
export async function upload(pathname, file, opts = {}) {
  const signUrl = opts.handleUploadUrl;
  if (!signUrl) throw new Error('handleUploadUrl is required');

  const signRes = await fetch(signUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      pathname,
      contentType: file.type || opts.contentType || 'application/octet-stream',
      ...(opts.clientPayload ? { clientPayload: opts.clientPayload } : {}),
    }),
  });
  if (!signRes.ok) {
    const e = await signRes.json().catch(() => ({}));
    throw new Error(e.error || 'Upload setup failed');
  }
  const { uploadUrl, publicUrl, pathname: finalPathname } = await signRes.json();

  await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', uploadUrl);
    if (file.type) xhr.setRequestHeader('content-type', file.type);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && typeof opts.onUploadProgress === 'function') {
        opts.onUploadProgress({ percentage: (ev.loaded / ev.total) * 100, loaded: ev.loaded, total: ev.total });
      }
    };
    xhr.onload = () => (xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed: HTTP ' + xhr.status)));
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(file);
  });

  return { url: publicUrl, pathname: finalPathname || pathname, contentType: file.type };
}
