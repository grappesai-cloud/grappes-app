// ─── Level 2: Auto-Fix — Deterministic fixes for recurring Sonnet bugs ──────
// No AI, no cost, instant. Runs before QA to fix known patterns.

export interface AutoFixResult {
  html: string;
  fixes: string[];
}

export function autoFix(html: string, projectId?: string): AutoFixResult {
  const fixes: string[] = [];
  let fixed = html;

  // ── 1. Lenis double-raf ────────────────────────────────────────────────
  // Sonnet writes both requestAnimationFrame loop AND gsap.ticker for Lenis.
  // Keep only gsap.ticker (the correct one).
  const hasRafLoop = /function\s+raf\s*\(\s*time\s*\)\s*\{[^}]*lenis\.raf\s*\(\s*time\s*\)/s.test(fixed);
  const hasGsapTicker = /gsap\.ticker\.add\s*\([^)]*lenis\.raf/s.test(fixed);

  if (hasRafLoop && hasGsapTicker) {
    // Remove the requestAnimationFrame loop (keep gsap.ticker)
    fixed = fixed.replace(
      /function\s+raf\s*\(\s*time\s*\)\s*\{[^}]*lenis\.raf\s*\(\s*time\s*\)[^}]*\}\s*requestAnimationFrame\s*\(\s*raf\s*\)\s*;?/gs,
      '// [auto-fix] removed duplicate Lenis raf loop — using gsap.ticker instead'
    );
    fixes.push('Removed Lenis double-raf (kept gsap.ticker)');
  }

  // ── 2. Form action normalization ───────────────────────────────────────
  // injectFormHandler (creative-generation.ts) handles the actual submission handler.
  // Here we only ensure forms without an action don't do a hard page reload.
  const formMatches = [...fixed.matchAll(/<form([^>]*)>/gi)];
  // Apply replacements in reverse order to preserve match indices
  for (let i = formMatches.length - 1; i >= 0; i--) {
    const formMatch = formMatches[i];
    const attrs = formMatch[1];
    const hasAction = /\baction\s*=/.test(attrs);
    const hasSubmitHandler = /\bonsubmit\s*=/.test(attrs);
    if (!hasAction && !hasSubmitHandler) {
      const original = formMatch[0];
      const replacement = original.replace('<form', '<form onsubmit="event.preventDefault()"');
      fixed = fixed.slice(0, formMatch.index!) + replacement + fixed.slice(formMatch.index! + original.length);
      fixes.push('Added onsubmit preventDefault to form without action');
    }
  }

  // ── 3. Effect runtime deduplication ────────────────────────────────────
  // Detect if window.__effectName is defined more than once
  const effectDefs = ['__textType', '__textPressure', '__variableProximity', '__curvedLoop',
    '__scrollStack', '__pillNav', '__flowingMenu', '__invertCorners'];

  for (const fn of effectDefs) {
    const defPattern = new RegExp(`window\\.${fn}\\s*=\\s*function`, 'g');
    const matches = fixed.match(defPattern);
    if (matches && matches.length > 1) {
      // Remove the "Injected Effect Runtimes" block (keep the one Sonnet wrote)
      fixed = fixed.replace(/\n*<script>\n*\/\* ── Injected Effect Runtimes ── \*\/[\s\S]*?<\/script>/g, '');
      fixes.push(`Removed duplicate ${fn} runtime injection`);
      break; // only need to fix once
    }
  }

  // ── 4. Font weight reduction ───────────────────────────────────────────
  // If Google Fonts URL has more than 3 weights per family, reduce
  const gfontsRegex = /href="(https:\/\/fonts\.googleapis\.com\/css2\?[^"]*)"/g;
  let gfMatch;
  while ((gfMatch = gfontsRegex.exec(fixed)) !== null) {
    const url = gfMatch[1];
    // Count wght values
    const wghtMatches = url.match(/wght@[\d;]+/g);
    if (wghtMatches) {
      for (const wght of wghtMatches) {
        const weights = wght.replace('wght@', '').split(';').filter(Boolean);
        if (weights.length > 4) {
          // Keep first 3 weights only
          const reduced = weights.slice(0, 3).join(';');
          const newUrl = url.replace(wght, `wght@${reduced}`);
          fixed = fixed.replace(url, newUrl);
          fixes.push(`Reduced font weights from ${weights.length} to 3`);
        }
      }
    }
  }

  // ── 5. Remove cursor:none if custom cursor div missing ─────────────────
  const hasCursorNone = /cursor\s*:\s*none/i.test(fixed);
  const hasCursorDiv = /class=["'][^"']*cursor[^"']*["']|id=["']cursor["']/i.test(fixed);
  if (hasCursorNone && !hasCursorDiv) {
    fixed = fixed.replace(/cursor\s*:\s*none\s*;?/gi, '/* cursor:none removed — no cursor element */');
    fixes.push('Removed cursor:none (no custom cursor element found)');
  }

  // ── 6. GSAP null-target guard ──────────────────────────────────────────
  // Sonnet generates `trigger: el.closest('section')` or `gsap.to(null, ...)` which
  // crashes GSAP with "Cannot set properties of undefined (setting 'parent')".
  // Inject a guard at the start of the first DOMContentLoaded listener.
  const hasDomReady = /document\.addEventListener\(['"]DOMContentLoaded/.test(fixed);
  const hasGuard = /__gsapGuardApplied/.test(fixed);
  if (hasDomReady && !hasGuard) {
    const guard = `window.__gsapGuardApplied=true;`
      + `if(window.ScrollTrigger){var _stC=ScrollTrigger.create.bind(ScrollTrigger);ScrollTrigger.create=function(v){if(!v||v.trigger==null)return null;return _stC(v);};}`
      + `if(window.gsap){['to','from','fromTo','set'].forEach(function(fn){var _o=gsap[fn].bind(gsap);gsap[fn]=function(){if(arguments[0]==null)return null;return _o.apply(gsap,arguments);};});}`;
    fixed = fixed.replace(
      /document\.addEventListener\(['"]DOMContentLoaded['"],\s*function\s*\(\)\s*\{/,
      `document.addEventListener('DOMContentLoaded', function () {\n  ${guard}`
    );
    fixes.push('Injected GSAP null-target guard');
  }

  // ── 7. Fix ALL CSS opacity:0 that GSAP would animate ───────────────────
  // If CSS sets opacity:0 on ANY element that GSAP animates, the element stays
  // invisible forever. Remove ALL opacity:0 from <style> blocks — GSAP handles initial state.
  // Only keep opacity:0 on elements that are clearly meant to be hidden (modals, menus, etc.)
  let revealFixCount = 0;
  const hasGsap = /gsap\b/.test(fixed);
  if (hasGsap) {
    const styleMatches = [...fixed.matchAll(/<style[\s\S]*?<\/style>/gi)];
    for (const styleMatch of styleMatches) {
      const originalStyle = styleMatch[0];
      // Remove opacity:0 from CSS rules, except for known UI elements (menu, modal, cursor, overlay)
      const cleanedStyle = originalStyle.replace(
        /((?:(?!mobile|menu|modal|overlay|cursor|hamburger|mob-menu|mob\b|hidden)[^\{])*\{[^}]*?)opacity\s*:\s*0\s*;?/gi,
        function(match, prefix) {
          // Skip if it's inside a UI-related selector
          if (/mobile|menu|modal|overlay|cursor|hamburger|mob|hidden|\.mob\b/i.test(prefix)) return match;
          revealFixCount++;
          return match.replace(/opacity\s*:\s*0\s*;?/i, '/* opacity:0 removed — GSAP handles */');
        }
      );
      if (cleanedStyle !== originalStyle) {
        fixed = fixed.replace(originalStyle, cleanedStyle);
      }
    }
  }
  if (revealFixCount > 0) {
    fixes.push(`Removed CSS opacity:0 from ${revealFixCount} rule(s) — GSAP handles initial state`);
  }

  // ── 8. Ensure Lenis → ScrollTrigger connection ────────────────────────
  // Without this, ScrollTrigger won't detect Lenis scroll events.
  const hasLenis = /new Lenis\b/.test(fixed);
  const hasScrollTriggerUpdate = /lenis\.on\s*\(\s*['"]scroll['"].*ScrollTrigger\.update/.test(fixed);
  if (hasLenis && !hasScrollTriggerUpdate && /ScrollTrigger/.test(fixed)) {
    // Inject connection after Lenis instantiation
    const lenisCreation = fixed.match(/var\s+lenis\s*=\s*new\s+Lenis\s*\([^)]*\)\s*;?/);
    if (lenisCreation) {
      const injection = `\n  // [auto-fix] Connect Lenis to ScrollTrigger\n  lenis.on('scroll', ScrollTrigger.update);`;
      fixed = fixed.replace(lenisCreation[0], lenisCreation[0] + injection);
      fixes.push('Injected Lenis → ScrollTrigger.update connection');
    }
  }

  // ── 9. Add loading="lazy" to below-fold images ────────────────────────
  // First <img> (likely hero) keeps eager loading, rest get lazy
  let imgIndex = 0;
  let lazyAdded = 0;
  fixed = fixed.replace(/<img\b([^>]*?)>/gi, function(match, attrs) {
    imgIndex++;
    if (imgIndex <= 2) return match; // skip first 2 images (logo + hero) for LCP
    if (/loading\s*=/.test(attrs)) return match; // already has loading attr
    lazyAdded++;
    return match.replace('<img', '<img loading="lazy"');
  });
  if (lazyAdded > 0) {
    fixes.push(`Added loading="lazy" to ${lazyAdded} below-fold images`);
  }

  // ── 10. Ensure mobile menu starts CLOSED ─────────────────────────────
  // Sonnet sometimes generates mobile menu with 'open' or 'active' class by default
  fixed = fixed.replace(
    /class="([^"]*(?:mobile-menu|mob-menu|mob)[^"]*)"/gi,
    function(match, classes) {
      if (/\b(open|active)\b/.test(classes)) {
        fixes.push('Removed open/active class from mobile menu (was open by default)');
        return 'class="' + classes.replace(/\b(open|active)\b/g, '').replace(/\s+/g, ' ').trim() + '"';
      }
      return match;
    }
  );

  // ── 11. Ensure mobile menu has pointer-events:none when closed ──────
  // If mobile menu CSS uses opacity transition but no pointer-events, it blocks clicks
  const menuOverlay = fixed.match(/\.(mobile-menu|mob-menu|mob|nav-overlay|mobile-nav|sidebar-menu|hamburger-menu|nav-menu|slide-menu|offcanvas)\s*\{([^}]*)\}/i);
  if (menuOverlay && !menuOverlay[2].includes('pointer-events')) {
    fixed = fixed.replace(
      menuOverlay[0],
      menuOverlay[0].replace('{', '{ pointer-events: none; ')
    );
    fixes.push('Added pointer-events:none to closed mobile menu');
  }
  // And ensure .open state has pointer-events:all
  const menuOpen = fixed.match(/\.(mobile-menu|mob-menu|mob|nav-overlay|mobile-nav|sidebar-menu|hamburger-menu|nav-menu|slide-menu|offcanvas)\.open\s*\{([^}]*)\}/i);
  if (menuOpen && !menuOpen[2].includes('pointer-events')) {
    fixed = fixed.replace(menuOpen[0], menuOpen[0].replace('{', '{ pointer-events: all; '));
    fixes.push('Added pointer-events:all to open mobile menu');
  }

  // ── 12. Ensure sections clip their overflow ─────────────────────────
  // Sonnet uses position:absolute or oversized elements that bleed into
  // neighbouring sections, creating ugly overlaps. Add overflow:hidden
  // to data-section containers (except hero, which may intentionally bleed).
  const hasSections = /data-section=/.test(fixed);
  if (hasSections) {
    const styleEnd = fixed.match(/<\/style>/i);
    if (styleEnd && styleEnd.index !== undefined) {
      const sectionClip = `\n/* [auto-fix] Prevent section overlap */\n[data-section] { overflow: hidden; position: relative; }\n[data-section="hero"], [data-section="nav"] { overflow: visible; }\n`;
      // Only inject if not already present
      if (!fixed.includes('[data-section] { overflow: hidden')) {
        fixed = fixed.slice(0, styleEnd.index) + sectionClip + fixed.slice(styleEnd.index);
        fixes.push('Added overflow:hidden to data-section containers (prevents inter-section overlap)');
      }
    }
  }

  // ── 13. Deduplicate section IDs ────────────────────────────────────
  // Sonnet sometimes generates duplicate section comment markers.
  // Rename duplicates by appending -2, -3, etc.
  const sectionIds: Record<string, number> = {};
  fixed = fixed.replace(/<!-- SECTION:(\w+) -->/g, function(match, id) {
    sectionIds[id] = (sectionIds[id] || 0) + 1;
    if (sectionIds[id] > 1) {
      const newId = id + '-' + sectionIds[id];
      fixes.push(`Renamed duplicate section "${id}" to "${newId}"`);
      return `<!-- SECTION:${newId} -->`;
    }
    return match;
  });
  // Also fix closing markers and data-section attributes for renamed sections
  for (const [id, count] of Object.entries(sectionIds)) {
    if (count <= 1) continue;
    let occurrence = 0;
    fixed = fixed.replace(new RegExp(`<!-- /SECTION:${id} -->`, 'g'), function(match) {
      occurrence++;
      return occurrence > 1 ? `<!-- /SECTION:${id}-${occurrence} -->` : match;
    });
    let dsOccurrence = 0;
    fixed = fixed.replace(new RegExp(`data-section="${id}"`, 'g'), function(match) {
      dsOccurrence++;
      return dsOccurrence > 1 ? `data-section="${id}-${dsOccurrence}"` : match;
    });
  }

  return { html: fixed, fixes };
}
