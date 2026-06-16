// Drop-in replacement for @vercel/blob/client's `upload()`. Streams the file to
// our own same-origin endpoint (handleUploadUrl) as multipart/form-data; the
// server stores it in Cloudflare R2 and returns { url, pathname }. Going through
// our own origin means NO bucket CORS, no presigned-URL checksum/expiry quirks.
// Keeps the same call shape as before: upload(pathname, file, { handleUploadUrl,
// clientPayload?, contentType?, onUploadProgress? }).
export async function upload(pathname, file, opts = {}) {
  const endpoint = opts.handleUploadUrl;
  if (!endpoint) throw new Error('handleUploadUrl is required');

  const fd = new FormData();
  fd.append('pathname', pathname);
  fd.append('contentType', file.type || opts.contentType || 'application/octet-stream');
  if (opts.clientPayload) fd.append('clientPayload', opts.clientPayload);
  fd.append('file', file, file.name || 'upload');

  const result = await new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', endpoint);
    xhr.upload.onprogress = (ev) => {
      if (ev.lengthComputable && typeof opts.onUploadProgress === 'function') {
        opts.onUploadProgress({ percentage: (ev.loaded / ev.total) * 100, loaded: ev.loaded, total: ev.total });
      }
    };
    xhr.onload = () => {
      let j = {};
      try { j = JSON.parse(xhr.responseText); } catch { /* non-JSON */ }
      if (xhr.status >= 200 && xhr.status < 300) resolve(j);
      else reject(new Error(j.error || ('Upload failed: HTTP ' + xhr.status)));
    };
    xhr.onerror = () => reject(new Error('Upload network error'));
    xhr.send(fd);
  });

  return { url: result.url, pathname: result.pathname || pathname, contentType: file.type };
}
