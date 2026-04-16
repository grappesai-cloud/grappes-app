// ─── Preview endpoint ─────────────────────────────────────────────────────────
// Serves the assembled HTML preview same-origin from the platform.
// Same-origin = no cross-origin restrictions → instant hot-swap edits,
// section click → sidebar sync, active section highlighting.

import type { APIRoute } from 'astro';
import { createHmac } from 'node:crypto';
import { db } from '../../lib/db';
import { buildSiteArchitecture } from '../../lib/generation';
import { assemblePreviewPage, injectEditModeIntoFullPage, injectWnIds, HTML_KEY_PREFIX, FULL_PAGE_KEY } from '../../lib/html-compat';
import { stripTypescriptFromHtml } from '../../lib/strip-ts';

/** Generate a share token for public preview access */
export function generateShareToken(projectId: string): string {
  const secret = import.meta.env.SHARE_TOKEN_SECRET ?? import.meta.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error('SHARE_TOKEN_SECRET or SUPABASE_SERVICE_ROLE_KEY must be set');
  return createHmac('sha256', secret).update(`share:${projectId}`).digest('hex').slice(0, 24);
}

export const GET: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  const url = new URL(request.url);
  const shareToken = url.searchParams.get('token');

  // Allow access via share token (public preview) or authenticated owner
  let isShareAccess = false;
  const project = await db.projects.findById(params.projectId!);
  if (!project) return new Response('Not found', { status: 404 });

  if (shareToken) {
    const expected = generateShareToken(params.projectId!);
    isShareAccess = shareToken === expected;
  }

  if (!isShareAccess) {
    if (!user) return new Response('Unauthorized', { status: 401 });
    if (project.user_id !== user.id) return new Response('Not found', { status: 404 });
  }

  const gen = await db.generatedFiles.findLatest(params.projectId!);
  if (!gen?.files) {
    return new Response(noPreviewHtml('No preview generated yet.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  // Enable edit mode when loaded from within the platform editor (never for public share access)
  const referer  = request.headers.get('referer') ?? '';
  const editMode = !isShareAccess && (referer.includes('/edit') || url.searchParams.has('edit'));

  // ── Multi-page: serve individual page via ?page=about.html ─────────────────
  const pageParam = url.searchParams.get('page');
  if (pageParam) {
    const pageKey = `__page__${pageParam}`;
    const pageHtml = gen.files[pageKey];
    if (pageHtml) {
      // Rewrite relative page hrefs to use ?page= so navigation works in preview
      const rewritten = rewritePageLinks(pageHtml, params.projectId!);
      return new Response(rewritten, {
        status: 200,
        headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store, no-cache' },
      });
    }
    return new Response('Page not found', { status: 404 });
  }

  // ── New approach: serve full HTML page directly ─────────────────────────────
  const storedFullHtml = gen.files[FULL_PAGE_KEY];
  if (storedFullHtml) {
    // For multi-page sites, rewrite nav links before serving index
    const isMultiPage = !!gen.files['__multipage'];
    let html = isMultiPage ? rewritePageLinks(storedFullHtml, params.projectId!) : storedFullHtml;
    html = normalizeOldHtml(html, params.projectId!);
    html = stripTypescriptFromHtml(html);
    html = injectGsapGuard(html);
    if (editMode) {
      // Persist wn-ids into stored HTML on first edit access (lazy init).
      // Important: inject IDs BEFORE normalization so stored IDs match served IDs.
      {
        // Always re-inject IDs (new tags may have been added to EDITABLE_TAGS)
        const withIds = injectWnIds(storedFullHtml);
        if (withIds !== storedFullHtml) {
          const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: withIds };
          db.generatedFiles.update(gen.id, { files: updatedFiles }).catch(() => {});
        }
        // Re-derive served HTML from the ID-injected version so IDs match
        html = isMultiPage ? rewritePageLinks(withIds, params.projectId!) : withIds;
        html = normalizeOldHtml(html, params.projectId!);
        html = stripTypescriptFromHtml(html);
        html = injectGsapGuard(html);
      }
      html = injectEditModeIntoFullPage(html);
    }
    // CSP: allow inline styles/scripts (AI-generated HTML), CDN resources, images,
    // + third-party integrations (analytics providers, booking widgets, audio embeds).
    const csp = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' https://cdn.jsdelivr.net https://unpkg.com https://www.googletagmanager.com https://plausible.io https://cdn.usefathom.com https://app.cal.com https://assets.calendly.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://assets.calendly.com",
      "font-src 'self' https://fonts.gstatic.com",
      "img-src 'self' data: blob: https: http:",
      "media-src 'self' https: blob:",
      "connect-src 'self' https://grappes.dev https://www.google-analytics.com https://cdn.jsdelivr.net https://unpkg.com https://plausible.io https://cdn.usefathom.com https://api.cal.com https://calendly.com",
      "frame-src 'self' https://cal.com https://app.cal.com https://calendly.com https://open.spotify.com https://www.youtube.com https://youtube.com https://w.soundcloud.com https://embed.music.apple.com",
      "frame-ancestors 'self'",
    ].join('; ');

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html; charset=utf-8',
        'Cache-Control': 'no-store, no-cache',
        'Content-Security-Policy': csp,
        'X-Content-Type-Options': 'nosniff',
      },
    });
  }

  // ── Legacy fallback: assemble from individual sections ──────────────────────
  const sectionHtmls: Record<string, string> = {};
  for (const [key, value] of Object.entries(gen.files)) {
    if (key.startsWith(HTML_KEY_PREFIX) && key !== FULL_PAGE_KEY) {
      sectionHtmls[key.slice(HTML_KEY_PREFIX.length)] = value;
    }
  }

  if (Object.keys(sectionHtmls).length === 0) {
    return new Response(noPreviewHtml('No HTML sections found. Re-generate the site.'), {
      status: 404,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const brief = await db.briefs.findByProjectId(params.projectId!);
  if (!brief) {
    return new Response('Brief not found', { status: 404 });
  }

  const arch = buildSiteArchitecture(brief.data);

  const rawHtml = assemblePreviewPage({ sectionHtmls, arch, editMode });
  const html = injectGsapGuard(stripTypescriptFromHtml(rawHtml));

  return new Response(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store, no-cache', // always fresh during editing
    },
  });
};

/**
 * Normalize HTML generated under old domain (adsnow.ro) or with stale references.
 * Runs on every preview request so old stored HTML gets fixed transparently.
 */
function normalizeOldHtml(html: string, projectId: string): string {
  // Replace adsnow.ro analytics beacons with grappes.dev
  html = html.replace(
    /['"]https?:\/\/(?:www\.)?adsnow\.ro\/api\/analytics\/[^'"]+['"]/g,
    `'https://grappes.dev/api/analytics/${projectId}'`
  );
  // Replace old relative analytics path that resolves to wrong origin on deployed sites
  html = html.replace(
    /var p=['"]\/api\/analytics\/[^'"]+['"]/g,
    `var p='https://grappes.dev/api/analytics/${projectId}'`
  );
  // Replace adsnow.ro backlink with grappes.dev
  html = html.replace(/https:\/\/adsnow\.ro(?=['"])/g, 'https://grappes.dev');
  html = html.replace(/by adsnow\.ro/g, 'by grappes.dev');

  // Remove duplicate inline <script> blocks (same first 80 chars = same script)
  const seen = new Set<string>();
  html = html.replace(/<script(?:\s[^>]*)?>[\s\S]*?<\/script>/gi, (match) => {
    if (/\bsrc\s*=/.test(match)) return match; // keep external scripts
    const key = match.slice(0, 120).replace(/\s+/g, ' ');
    if (seen.has(key)) return '';
    seen.add(key);
    return match;
  });

  return html;
}

/**
 * Inject a GSAP null-target guard at the start of the first DOMContentLoaded
 * listener. Patches ScrollTrigger.create and gsap.to/from/fromTo/set to
 * silently skip null/undefined targets instead of throwing.
 * Sonnet sometimes generates `trigger: el.closest('section')` where the element
 * is not inside a section, producing null — which crashes GSAP.
 */
function injectGsapGuard(html: string): string {
  const guard = `if(window.ScrollTrigger){var _stC=ScrollTrigger.create.bind(ScrollTrigger);ScrollTrigger.create=function(v){if(!v||v.trigger==null)return null;return _stC(v);};}`
    + `if(window.gsap){['to','from','fromTo','set'].forEach(function(fn){var _o=gsap[fn].bind(gsap);gsap[fn]=function(){if(arguments[0]==null)return null;return _o.apply(gsap,arguments);};});}`;
  return html.replace(
    /document\.addEventListener\(['"]DOMContentLoaded['"],\s*function\s*\(\)\s*\{/,
    `document.addEventListener('DOMContentLoaded', function () {\n  ${guard}`
  );
}

function escapeHtmlPreview(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function noPreviewHtml(message: string): string {
  return `<!DOCTYPE html><html><body style="font-family:sans-serif;display:flex;align-items:center;justify-content:center;height:100vh;color:#666;background:#f9f9f9;">
  <p>${escapeHtmlPreview(message)}</p>
</body></html>`;
}

// Rewrites relative page hrefs (e.g. href="about.html") to preview ?page= URLs
// so multi-page navigation works inside the platform preview.
function rewritePageLinks(html: string, projectId: string): string {
  return html.replace(
    /href="([a-z0-9-]+\.html)"/gi,
    (match, filename) => {
      if (filename === 'index.html') {
        return `href="/preview/${projectId}"`;
      }
      return `href="/preview/${projectId}?page=${filename}"`;
    }
  );
}
