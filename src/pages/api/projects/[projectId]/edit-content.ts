// ─── Content Editing Endpoint ────────────────────────────────────────────────
// Supports two modes:
//   1. Visual editor:  { wnId, prop, value, oldValue? }  — patch by data-wn-id
//   2. Legacy:         { type, oldValue, newValue }       — find-replace

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { FULL_PAGE_KEY } from '../../../../lib/creative-generation';
import { checkRateLimit } from '../../../../lib/rate-limit';

import { json } from '../../../../lib/api-utils';
/** Escape $ signs so String.replace() doesn't interpret backreferences like $1, $&, $' */
function escapeDollar(str: string): string {
  return str.replace(/\$/g, '$$$$');
}


export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`edit-content:${user.id}`, 60, 3_600_000)) {
    return json({ error: 'Too many edit requests. Please wait before continuing.' }, 429);
  }

  try {
    const body = await request.json();

    const project = await db.projects.findById(params.projectId!);
    if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);
    if (project.billing_status === 'expired') return json({ error: 'Your site plan has expired. Please renew to edit.' }, 403);

    const gen = await db.generatedFiles.findLatest(params.projectId!);
    if (!gen?.files?.[FULL_PAGE_KEY]) return json({ error: 'No generated site found' }, 404);

    let html = gen.files[FULL_PAGE_KEY];

    // ── Delete element or section ────────────────────────────────────────
    if (body.prop === 'delete') {
      if (body.wnId) {
        // Delete element by data-wn-id — remove the entire element (open tag through close tag)
        const wnAttr = `data-wn-id="${body.wnId}"`;
        if (!html.includes(wnAttr)) return json({ error: 'Element not found' }, 404);

        const escapedWn = wnAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const tagMatch = html.match(new RegExp(`<(\\w+)[^>]*${escapedWn}[^>]*>`));
        if (!tagMatch) return json({ error: 'Element not found in HTML' }, 404);

        const tagName = tagMatch[1].toLowerCase();
        const openTag = tagMatch[0];
        const startPos = html.indexOf(openTag);

        // Self-closing tags (img, br, hr, input)
        if (/\/>$/.test(openTag) || ['img', 'br', 'hr', 'input'].includes(tagName)) {
          html = html.slice(0, startPos) + html.slice(startPos + openTag.length);
        } else {
          // Find matching closing tag
          const contentStart = startPos + openTag.length;
          let depth = 1;
          let pos = contentStart;
          const openRe = new RegExp(`<${tagName}\\b`, 'gi');
          const closeRe = new RegExp(`</${tagName}>`, 'gi');
          let endPos = -1;

          while (depth > 0 && pos < html.length) {
            openRe.lastIndex = pos;
            closeRe.lastIndex = pos;
            const nextOpen = openRe.exec(html);
            const nextClose = closeRe.exec(html);
            if (!nextClose) break;
            if (nextOpen && nextOpen.index < nextClose.index) {
              depth++;
              pos = nextOpen.index + nextOpen[0].length;
            } else {
              depth--;
              if (depth === 0) { endPos = nextClose.index + nextClose[0].length; break; }
              pos = nextClose.index + nextClose[0].length;
            }
          }

          if (endPos === -1) return json({ error: 'Could not match element boundaries' }, 404);
          html = html.slice(0, startPos) + html.slice(endPos);
        }

        const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: html };
        await db.generatedFiles.create({
          project_id: params.projectId!,
          version: gen.version + 1,
          files: updatedFiles,
          generation_cost: 0,
          generation_tokens: 0,
        });
        console.log(`[edit-content] Deleted element wn-id ${body.wnId} from project ${params.projectId}`);
        return json({ success: true, deleted: 'element', wnId: body.wnId });
      }

      if (body.sectionId) {
        // Delete entire section — remove <!-- SECTION:id --> ... <!-- /SECTION:id --> block
        const sectionAttr = `data-section="${body.sectionId}"`;
        if (!html.includes(sectionAttr)) return json({ error: 'Section not found' }, 404);

        // Try comment-based removal first
        const commentStart = `<!-- SECTION:${body.sectionId} -->`;
        const commentEnd = `<!-- /SECTION:${body.sectionId} -->`;
        if (html.includes(commentStart) && html.includes(commentEnd)) {
          const start = html.indexOf(commentStart);
          const end = html.indexOf(commentEnd) + commentEnd.length;
          html = html.slice(0, start) + html.slice(end);
        } else {
          // Fallback: remove the tag with data-section attribute and its contents
          const escapedAttr = sectionAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tagMatch = html.match(new RegExp(`<(\\w+)[^>]*${escapedAttr}[^>]*>`));
          if (!tagMatch) return json({ error: 'Section tag not found' }, 404);

          const tagName = tagMatch[1].toLowerCase();
          const openTag = tagMatch[0];
          const startPos = html.indexOf(openTag);
          const contentStart = startPos + openTag.length;
          let depth = 1;
          let pos = contentStart;
          const openRe = new RegExp(`<${tagName}\\b`, 'gi');
          const closeRe = new RegExp(`</${tagName}>`, 'gi');
          let endPos = -1;

          while (depth > 0 && pos < html.length) {
            openRe.lastIndex = pos;
            closeRe.lastIndex = pos;
            const nextOpen = openRe.exec(html);
            const nextClose = closeRe.exec(html);
            if (!nextClose) break;
            if (nextOpen && nextOpen.index < nextClose.index) {
              depth++;
              pos = nextOpen.index + nextOpen[0].length;
            } else {
              depth--;
              if (depth === 0) { endPos = nextClose.index + nextClose[0].length; break; }
              pos = nextClose.index + nextClose[0].length;
            }
          }

          if (endPos === -1) return json({ error: 'Could not match section boundaries' }, 404);
          html = html.slice(0, startPos) + html.slice(endPos);
        }

        const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: html };
        await db.generatedFiles.create({
          project_id: params.projectId!,
          version: gen.version + 1,
          files: updatedFiles,
          generation_cost: 0,
          generation_tokens: 0,
        });
        console.log(`[edit-content] Deleted section ${body.sectionId} from project ${params.projectId}`);
        return json({ success: true, deleted: 'section', sectionId: body.sectionId });
      }

      return json({ error: 'Delete requires wnId or sectionId' }, 400);
    }

    // ── Mode 0: Section-level style (data-section based) ─────────────────
    if (body.sectionId && !body.wnId) {
      const { sectionId, prop, value } = body as { sectionId: string; prop: string; value: string };
      if (!prop || value === undefined) return json({ error: 'prop and value required' }, 400);

      const sectionAttr = `data-section="${sectionId}"`;
      if (!html.includes(sectionAttr)) return json({ error: 'Section not found' }, 404);

      const allowedProps = ['background-color', 'color', 'background', 'background-image', 'background-size', 'background-position'];
      if (!allowedProps.includes(prop)) return json({ error: `Unsupported section prop: ${prop}` }, 400);

      const escapedAttr = sectionAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const tagRegex = new RegExp(`<\\w+[^>]*${escapedAttr}[^>]*>`);
      const tagMatch = html.match(tagRegex);
      if (!tagMatch) return json({ error: 'Section tag not found' }, 404);

      const oldTag = tagMatch[0];
      const propCss = prop;
      let newTag: string;

      const styleMatch = /\bstyle="([^"]*)"/.exec(oldTag);
      if (styleMatch) {
        const propRegex = new RegExp(`${propCss}\\s*:[^;]*;?`);
        const newStyleVal = propRegex.test(styleMatch[1])
          ? styleMatch[1].replace(propRegex, `${propCss}: ${value};`)
          : styleMatch[1].replace(/;?\s*$/, `; ${propCss}: ${value};`);
        newTag = oldTag.replace(/\bstyle="[^"]*"/, `style="${newStyleVal}"`);
      } else {
        newTag = oldTag.replace(/>$/, ` style="${propCss}: ${value};">`);
      }

      html = html.replace(oldTag, newTag);
      const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: html };
      await db.generatedFiles.create({
        project_id: params.projectId!,
        version: gen.version + 1,
        files: updatedFiles,
        generation_cost: 0,
        generation_tokens: 0,
      });
      console.log(`[edit-content] section ${sectionId} ${prop} updated for project ${params.projectId}`);
      return json({ success: true, sectionId, prop });
    }

    // ── Mode 1: Visual editor (data-wn-id based) ────────────────────────
    if (body.wnId) {
      const { wnId, prop, value } = body as { wnId: string; prop: string; value: string };
      if (!prop || value === undefined) return json({ error: 'prop and value required' }, 400);

      const wnAttr = `data-wn-id="${wnId}"`;
      if (!html.includes(wnAttr)) return json({ error: 'Element not found' }, 404);

      switch (prop) {
        case 'innerHTML': {
          // Find the element's opening tag
          const escapedWn = wnAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tagMatch = html.match(new RegExp(`<(\\w+)[^>]*${escapedWn}[^>]*>`));
          if (!tagMatch) return json({ error: 'Element not found in HTML' }, 404);

          const tagName = tagMatch[1].toLowerCase();
          const openTag = tagMatch[0];
          const startPos = html.indexOf(openTag);
          const contentStart = startPos + openTag.length;

          // Find matching closing tag by counting nesting depth
          let depth = 1;
          let pos = contentStart;
          const openRe = new RegExp(`<${tagName}\\b`, 'gi');
          const closeRe = new RegExp(`</${tagName}>`, 'gi');
          let contentEnd = -1;

          while (depth > 0 && pos < html.length) {
            openRe.lastIndex = pos;
            closeRe.lastIndex = pos;
            const nextOpen = openRe.exec(html);
            const nextClose = closeRe.exec(html);
            if (!nextClose) break;

            if (nextOpen && nextOpen.index < nextClose.index) {
              depth++;
              pos = nextOpen.index + nextOpen[0].length;
            } else {
              depth--;
              if (depth === 0) { contentEnd = nextClose.index; break; }
              pos = nextClose.index + nextClose[0].length;
            }
          }

          if (contentEnd === -1) return json({ error: 'Could not match element boundaries' }, 404);
          html = html.slice(0, contentStart) + value + html.slice(contentEnd);
          break;
        }

        case 'src': {
          // Replace src attribute value on the element with this wn-id
          const srcRegex = new RegExp(
            `(<[^>]*${wnAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^>]*\\bsrc=")[^"]*(")`
          );
          if (!srcRegex.test(html)) return json({ error: 'src attribute not found' }, 404);
          html = html.replace(srcRegex, `$1${escapeDollar(value)}$2`);
          break;
        }

        case 'background-color':
        case 'background-image':
        case 'background-size':
        case 'background-position':
        case 'color':
        case 'font-size':
        case 'font-weight':
        case 'font-style':
        case 'font-family':
        case 'text-align': {
          // Find the full opening tag that contains this wn-id
          const escapedAttr = wnAttr.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          const tagRegex = new RegExp(`<\\w+[^>]*${escapedAttr}[^>]*(?:\\/>|>)`);
          const tagMatch = html.match(tagRegex);
          if (!tagMatch) return json({ error: 'Element not found' }, 404);

          const oldTag = tagMatch[0];
          const propCss = prop;
          let newTag: string;

          const styleMatch = /\bstyle="([^"]*)"/.exec(oldTag);
          if (styleMatch) {
            // Has existing style — update or append property
            const propRegex = new RegExp(`${propCss}\\s*:[^;]*;?`);
            const newStyleVal = propRegex.test(styleMatch[1])
              ? styleMatch[1].replace(propRegex, `${propCss}: ${value};`)
              : styleMatch[1].replace(/;?\s*$/, `; ${propCss}: ${value};`);
            newTag = oldTag.replace(/\bstyle="[^"]*"/, `style="${newStyleVal}"`);
          } else {
            // No style — insert before closing > or />
            newTag = oldTag.replace(/\/?>$/, ` style="${propCss}: ${value};"$&`);
          }

          html = html.replace(oldTag, newTag);
          break;
        }

        default:
          return json({ error: `Unsupported prop: ${prop}` }, 400);
      }

      const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: html };
      await db.generatedFiles.create({
        project_id: params.projectId!,
        version: gen.version + 1,
        files: updatedFiles,
        generation_cost: 0,
        generation_tokens: 0,
      });

      console.log(`[edit-content] wn-id ${wnId} ${prop} updated for project ${params.projectId}`);
      return json({ success: true, wnId, prop });
    }

    // ── Mode 2: Legacy find-replace ──────────────────────────────────────
    const { type, oldValue, newValue } = body as { type: string; oldValue: string; newValue: string };

    if (!oldValue || !newValue || oldValue === newValue) {
      return json({ error: 'Invalid edit: oldValue and newValue required and must differ' }, 400);
    }

    switch (type) {
      case 'text': {
        const escaped = oldValue.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regex = new RegExp(`(>\\s*)${escaped}(\\s*<)`, 'g');
        const count = (html.match(regex) || []).length;
        const safeNew = escapeDollar(newValue);
        if (count === 0) {
          if (html.includes(oldValue)) {
            html = html.replace(oldValue, safeNew);
          } else {
            return json({ error: 'Text not found in generated HTML' }, 404);
          }
        } else {
          html = html.replace(regex, `$1${safeNew}$2`);
        }
        break;
      }
      case 'image': {
        if (!html.includes(oldValue)) return json({ error: 'Image URL not found' }, 404);
        html = html.split(oldValue).join(newValue);
        break;
      }
      case 'link': {
        if (!html.includes(oldValue)) return json({ error: 'Link not found' }, 404);
        html = html.split(oldValue).join(newValue);
        break;
      }
      default:
        return json({ error: `Unknown edit type: ${type}` }, 400);
    }

    const updatedFiles = { ...gen.files, [FULL_PAGE_KEY]: html };
    await db.generatedFiles.create({
      project_id: params.projectId!,
      version: gen.version + 1,
      files: updatedFiles,
      generation_cost: 0,
      generation_tokens: 0,
    });

    console.log(`[edit-content] ${type} edit for project ${params.projectId}: "${oldValue.slice(0, 50)}" → "${newValue.slice(0, 50)}"`);
    return json({ success: true, type });

  } catch (e: any) {
    console.error('[edit-content] Error:', e);
    return json({ error: 'Internal error' }, 500);
  }
};
