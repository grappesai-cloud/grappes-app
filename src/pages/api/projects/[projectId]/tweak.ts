import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { FULL_PAGE_KEY } from '../../../../lib/creative-generation';
import { buildGoogleFontsUrl } from '../../../../lib/template';
import { json } from '../../../../lib/api-utils';


// ── POST — global CSS variable tweak ─────────────────────────────────────────

interface TweakBody {
  primaryColor?: string;
  secondaryColor?: string;
  accentColor?: string;
  headingFont?: string;
  bodyFont?: string;
}

/**
 * Replace a CSS custom property value inside the :root { … } block.
 * The regex captures everything up to (and including) the property name + colon,
 * then replaces the value before the semicolon.
 */
function replaceCssVar(html: string, varName: string, newValue: string): string {
  const escaped = varName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(${escaped}:\\s*)[^;]+`, 'g');
  return html.replace(pattern, (match, prefix) => prefix + newValue);
}

/**
 * Update the Google Fonts <link> URLs in the <head>.
 * Matches both preload and stylesheet link patterns pointing at fonts.googleapis.com.
 */
function replaceGoogleFontsUrl(html: string, newUrl: string): string {
  // Match href="https://fonts.googleapis.com/css2?..." in link tags
  return html.replace(
    /href="https:\/\/fonts\.googleapis\.com\/css2\?[^"]*"/g,
    `href="${newUrl}"`,
  );
}

export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  try {
    const body = (await request.json().catch(() => ({}))) as TweakBody;
    const { primaryColor, secondaryColor, accentColor, headingFont, bodyFont } = body;

    // Require at least one tweak field
    if (!primaryColor && !secondaryColor && !accentColor && !headingFont && !bodyFont) {
      return json(
        { error: 'At least one tweak field is required (primaryColor, secondaryColor, accentColor, headingFont, bodyFont)' },
        400,
      );
    }

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

    const gen = await db.generatedFiles.findLatest(params.projectId!);
    if (!gen?.files) return json({ error: 'No generated files found. Launch the site first.' }, 409);

    const fullHtml = gen.files[FULL_PAGE_KEY];
    if (!fullHtml) return json({ error: 'Full page HTML not found. Regenerate the site first.' }, 409);

    // ── Apply CSS variable replacements on the full page HTML ──────────────
    let updatedHtml = fullHtml;

    // Validate color values to prevent CSS injection
    const isValidColor = (v: string) => /^#[0-9a-fA-F]{3,8}$|^rgb\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*\)$|^rgba\(\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*\d{1,3}\s*,\s*[\d.]+\s*\)$/.test(v);

    if (primaryColor) {
      if (!isValidColor(primaryColor)) return json({ error: 'Invalid primaryColor format' }, 400);
      updatedHtml = replaceCssVar(updatedHtml, '--color-primary', primaryColor);
    }
    if (secondaryColor) {
      if (!isValidColor(secondaryColor)) return json({ error: 'Invalid secondaryColor format' }, 400);
      updatedHtml = replaceCssVar(updatedHtml, '--color-secondary', secondaryColor);
    }
    if (accentColor) {
      if (!isValidColor(accentColor)) return json({ error: 'Invalid accentColor format' }, 400);
      updatedHtml = replaceCssVar(updatedHtml, '--color-accent', accentColor);
    }
    if (headingFont) {
      const safeHeading = headingFont.replace(/['"\\;<>{}\(\)]/g, '').trim().slice(0, 60);
      updatedHtml = replaceCssVar(updatedHtml, '--font-heading', `'${safeHeading}', serif`);
    }
    if (bodyFont) {
      const safeBody = bodyFont.replace(/['"\\;<>{}\(\)]/g, '').trim().slice(0, 60);
      updatedHtml = replaceCssVar(updatedHtml, '--font-body', `'${safeBody}', sans-serif`);
    }

    // ── Update Google Fonts <link> URL if fonts changed ───────────────────
    if (headingFont || bodyFont) {
      // Extract current fonts from the HTML to fill in unchanged values
      const currentHeading = headingFont ?? extractFontName(fullHtml, '--font-heading');
      const currentBody = bodyFont ?? extractFontName(fullHtml, '--font-body');

      const newFontsUrl = buildGoogleFontsUrl(currentHeading, currentBody);
      updatedHtml = replaceGoogleFontsUrl(updatedHtml, newFontsUrl);
    }

    // ── Save updated files as a new version ──────────────────────────────
    const updatedFiles = {
      ...gen.files,
      [FULL_PAGE_KEY]: updatedHtml,
    };

    await db.generatedFiles.create({
      project_id: params.projectId!,
      version: gen.version + 1,
      files: updatedFiles,
      generation_cost: 0,
      generation_tokens: 0,
    });

    return json({
      previewUrl: `/preview/${params.projectId}`,
      version: gen.version + 1,
    });
  } catch (e: any) {
    console.error('[POST /api/projects/:id/tweak]', e);
    return json({ error: 'Internal server error' }, 500);
  }
};

/**
 * Extract the bare font name from the current HTML by reading the CSS variable value.
 * E.g. from `--font-heading: 'Playfair Display', serif;` extracts `Playfair Display`.
 */
function extractFontName(html: string, varName: string): string {
  const pattern = new RegExp(`${varName}:\\s*'([^']+)'`);
  const match = html.match(pattern);
  return match?.[1] ?? 'Inter';
}
