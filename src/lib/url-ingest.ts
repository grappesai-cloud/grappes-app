// ─── URL Ingestion ───────────────────────────────────────────────────────────
// Detect & extract usable metadata from URLs the user pastes during
// onboarding (Spotify, SoundCloud, YouTube, Apple Music).
//
// All providers use oEmbed (no auth) — title, thumbnail, embed iframe.
// For bulk image/asset uploads use the zip upload flow instead.

export type IngestedAssetKind = 'audio_embed' | 'video_embed';

export interface IngestedAsset {
  kind:        IngestedAssetKind;
  title?:      string;
  url:         string;            // canonical URL
  thumbnail?:  string;
  embedHtml?:  string;            // iframe HTML to drop into the site
  embedUrl?:   string;            // canonical embed URL
}

export interface IngestResult {
  source:    'spotify' | 'soundcloud' | 'youtube' | 'apple_music' | 'unknown';
  assets:    IngestedAsset[];
  summary:   string;              // human-readable, shown to Haiku as context
  raw?:      Record<string, any>;
}

// ── URL classification ──────────────────────────────────────────────────────

const SPOTIFY_RE     = /^https?:\/\/(open\.)?spotify\.com\//i;
const SOUNDCLOUD_RE  = /^https?:\/\/(www\.)?soundcloud\.com\//i;
const YOUTUBE_RE     = /^https?:\/\/(www\.|m\.)?(youtube\.com|youtu\.be)\//i;
const APPLE_MUSIC_RE = /^https?:\/\/music\.apple\.com\//i;

export function classifyUrl(url: string): IngestResult['source'] {
  if (SPOTIFY_RE.test(url))     return 'spotify';
  if (SOUNDCLOUD_RE.test(url))  return 'soundcloud';
  if (YOUTUBE_RE.test(url))     return 'youtube';
  if (APPLE_MUSIC_RE.test(url)) return 'apple_music';
  return 'unknown';
}

// ── oEmbed providers ────────────────────────────────────────────────────────

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
  // Apple Music has no public oEmbed — just rewrite to embed.music.apple.com
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
    case 'spotify':     return ingestSpotify(url);
    case 'soundcloud':  return ingestSoundCloud(url);
    case 'youtube':     return ingestYouTube(url);
    case 'apple_music': return ingestAppleMusic(url);
    default:
      return { source: 'unknown', assets: [], summary: `Unknown URL type: ${url}. Supported: Spotify, SoundCloud, YouTube, Apple Music. For bulk image uploads, attach a .zip in chat instead.` };
  }
}
