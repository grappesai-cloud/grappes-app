// ─── URL Ingestion ───────────────────────────────────────────────────────────
// Detect & extract usable assets/metadata from URLs the user pastes during
// onboarding (Google Drive folder, Spotify, SoundCloud, YouTube).
//
// Drive: list public folder via Drive API v3 (needs GOOGLE_API_KEY).
// Spotify/SoundCloud/YouTube: oEmbed (no auth) — title, thumbnail, embed iframe.

export type IngestedAssetKind = 'image' | 'audio_embed' | 'video_embed';

export interface IngestedAsset {
  kind:        IngestedAssetKind;
  title?:      string;
  url:         string;            // direct URL (image) or canonical URL (embed)
  thumbnail?:  string;
  embedHtml?:  string;            // for audio/video — iframe HTML to drop into the site
  embedUrl?:   string;            // canonical embed URL
  mimeType?:   string;            // images only
  sourceName?: string;            // file name from Drive
}

export interface IngestResult {
  source:    'drive' | 'spotify' | 'soundcloud' | 'youtube' | 'apple_music' | 'unknown';
  assets:    IngestedAsset[];
  summary:   string;              // human-readable, shown to Haiku as context
  raw?:      Record<string, any>;
}

// ── URL classification ──────────────────────────────────────────────────────

const DRIVE_FOLDER_RE  = /^https?:\/\/drive\.google\.com\/drive\/folders\/([a-zA-Z0-9_-]+)/i;
const DRIVE_FOLDER_ALT = /^https?:\/\/drive\.google\.com\/.*[?&]id=([a-zA-Z0-9_-]+)/i;
const SPOTIFY_RE       = /^https?:\/\/(open\.)?spotify\.com\//i;
const SOUNDCLOUD_RE    = /^https?:\/\/(www\.)?soundcloud\.com\//i;
const YOUTUBE_RE       = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const APPLE_MUSIC_RE   = /^https?:\/\/music\.apple\.com\//i;

export function classifyUrl(url: string): IngestResult['source'] {
  if (DRIVE_FOLDER_RE.test(url) || DRIVE_FOLDER_ALT.test(url)) return 'drive';
  if (SPOTIFY_RE.test(url))    return 'spotify';
  if (SOUNDCLOUD_RE.test(url)) return 'soundcloud';
  if (YOUTUBE_RE.test(url))    return 'youtube';
  if (APPLE_MUSIC_RE.test(url)) return 'apple_music';
  return 'unknown';
}

// ── Google Drive: list public folder ────────────────────────────────────────

interface DriveFile {
  id:           string;
  name:         string;
  mimeType:     string;
  thumbnailLink?: string;
  size?:        string;
}

async function listDriveFolder(folderId: string, apiKey: string): Promise<DriveFile[]> {
  const params = new URLSearchParams({
    q:        `'${folderId}' in parents and trashed = false`,
    fields:   'files(id,name,mimeType,thumbnailLink,size)',
    pageSize: '100',
    key:      apiKey,
  });
  const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`);
  if (!res.ok) {
    const errBody = await res.text().catch(() => '');
    throw new Error(`Drive API ${res.status}: ${errBody.slice(0, 200)}`);
  }
  const data = await res.json() as { files?: DriveFile[] };
  return data.files ?? [];
}

function driveDownloadUrl(fileId: string, apiKey: string): string {
  return `https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&key=${apiKey}`;
}

async function ingestDriveFolder(url: string): Promise<IngestResult> {
  const apiKey = import.meta.env.GOOGLE_API_KEY;
  if (!apiKey) {
    return {
      source:  'drive',
      assets:  [],
      summary: 'Google Drive ingestion not configured (GOOGLE_API_KEY missing). Ask user to upload files directly.',
    };
  }

  const m = url.match(DRIVE_FOLDER_RE) || url.match(DRIVE_FOLDER_ALT);
  const folderId = m?.[1];
  if (!folderId) {
    return { source: 'drive', assets: [], summary: 'Could not parse Drive folder ID from URL.' };
  }

  const files = await listDriveFolder(folderId, apiKey);
  const images = files.filter(f => f.mimeType.startsWith('image/'));
  const pdfs   = files.filter(f => f.mimeType === 'application/pdf');

  const assets: IngestedAsset[] = images.map(f => ({
    kind:       'image',
    title:      f.name,
    url:        driveDownloadUrl(f.id, apiKey),
    thumbnail:  f.thumbnailLink,
    mimeType:   f.mimeType,
    sourceName: f.name,
  }));

  const summary = images.length > 0
    ? `Drive folder contains ${images.length} image(s)${pdfs.length ? ` and ${pdfs.length} PDF(s)` : ''}: ${images.slice(0, 8).map(f => f.name).join(', ')}${images.length > 8 ? '…' : ''}`
    : `Drive folder is empty or contains no usable assets (${files.length} files total).`;

  return { source: 'drive', assets, summary, raw: { fileCount: files.length, imageCount: images.length, pdfCount: pdfs.length } };
}

// ── oEmbed providers (Spotify / SoundCloud / YouTube / Apple Music) ─────────

interface OEmbedResponse {
  title?:         string;
  author_name?:   string;
  thumbnail_url?: string;
  html?:          string;
  provider_name?: string;
}

async function fetchOEmbed(endpoint: string): Promise<OEmbedResponse | null> {
  try {
    const res = await fetch(endpoint, { headers: { 'User-Agent': 'grappes.dev/1.0' } });
    if (!res.ok) return null;
    return await res.json() as OEmbedResponse;
  } catch { return null; }
}

async function ingestSpotify(url: string): Promise<IngestResult> {
  const meta = await fetchOEmbed(`https://open.spotify.com/oembed?url=${encodeURIComponent(url)}`);
  if (!meta) return { source: 'spotify', assets: [], summary: 'Could not fetch Spotify metadata.' };

  // Build canonical embed URL: https://open.spotify.com/embed/{type}/{id}
  const m = url.match(/spotify\.com\/(track|album|playlist|artist|episode|show)\/([a-zA-Z0-9]+)/);
  const embedUrl = m ? `https://open.spotify.com/embed/${m[1]}/${m[2]}` : url;

  return {
    source: 'spotify',
    assets: [{
      kind:      'audio_embed',
      title:     meta.title,
      url,
      thumbnail: meta.thumbnail_url,
      embedHtml: meta.html ?? `<iframe src="${embedUrl}" width="100%" height="352" frameborder="0" allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture" loading="lazy"></iframe>`,
      embedUrl,
    }],
    summary: `Spotify: "${meta.title ?? 'untitled'}"${meta.author_name ? ` by ${meta.author_name}` : ''}. Embed available.`,
    raw: meta,
  };
}

async function ingestSoundCloud(url: string): Promise<IngestResult> {
  const meta = await fetchOEmbed(`https://soundcloud.com/oembed?format=json&url=${encodeURIComponent(url)}`);
  if (!meta) return { source: 'soundcloud', assets: [], summary: 'Could not fetch SoundCloud metadata.' };
  return {
    source: 'soundcloud',
    assets: [{
      kind:      'audio_embed',
      title:     meta.title,
      url,
      thumbnail: meta.thumbnail_url,
      embedHtml: meta.html,
    }],
    summary: `SoundCloud: "${meta.title ?? 'untitled'}"${meta.author_name ? ` by ${meta.author_name}` : ''}.`,
    raw: meta,
  };
}

async function ingestYouTube(url: string): Promise<IngestResult> {
  const meta = await fetchOEmbed(`https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`);
  if (!meta) return { source: 'youtube', assets: [], summary: 'Could not fetch YouTube metadata.' };
  // canonical embed
  const idMatch = url.match(/(?:v=|youtu\.be\/|embed\/)([a-zA-Z0-9_-]{11})/);
  const embedUrl = idMatch ? `https://www.youtube.com/embed/${idMatch[1]}` : url;
  return {
    source: 'youtube',
    assets: [{
      kind:      'video_embed',
      title:     meta.title,
      url,
      thumbnail: meta.thumbnail_url,
      embedHtml: meta.html ?? `<iframe src="${embedUrl}" width="560" height="315" frameborder="0" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen loading="lazy"></iframe>`,
      embedUrl,
    }],
    summary: `YouTube: "${meta.title ?? 'untitled'}"${meta.author_name ? ` by ${meta.author_name}` : ''}.`,
    raw: meta,
  };
}

async function ingestAppleMusic(url: string): Promise<IngestResult> {
  // Apple Music doesn't have public oEmbed; just return embed URL for music.apple.com /embed/
  const embedUrl = url.replace('music.apple.com/', 'embed.music.apple.com/');
  return {
    source: 'apple_music',
    assets: [{
      kind:      'audio_embed',
      title:     'Apple Music track',
      url,
      embedHtml: `<iframe src="${embedUrl}" width="100%" height="175" frameborder="0" allow="autoplay *; encrypted-media *;" loading="lazy"></iframe>`,
      embedUrl,
    }],
    summary: 'Apple Music link — embed available.',
  };
}

// ── Public entry point ──────────────────────────────────────────────────────

export async function ingestUrl(rawUrl: string): Promise<IngestResult> {
  let url: string;
  try { url = new URL(rawUrl.trim()).toString(); }
  catch { return { source: 'unknown', assets: [], summary: 'Invalid URL.' }; }

  const source = classifyUrl(url);
  switch (source) {
    case 'drive':       return ingestDriveFolder(url);
    case 'spotify':     return ingestSpotify(url);
    case 'soundcloud':  return ingestSoundCloud(url);
    case 'youtube':     return ingestYouTube(url);
    case 'apple_music': return ingestAppleMusic(url);
    default:
      return { source: 'unknown', assets: [], summary: `Unknown URL type: ${url}. Supported: Google Drive (folder), Spotify, SoundCloud, YouTube, Apple Music.` };
  }
}
