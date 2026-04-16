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
          const priority = ['400', '500', '600', '700', '300', '800', '900', '100', '200'];
          const sorted = [...weights].sort((a, b) => {
            const ai = priority.indexOf(a);
            const bi = priority.indexOf(b);
            return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi);
          });
          const kept = sorted.slice(0, 3).sort((a, b) => Number(a) - Number(b));
          const reduced = kept.join(';');
          const newUrl = url.replace(wght, `wght@${reduced}`);
          fixed = fixed.replace(url, newUrl);
          fixes.push(`Reduced font weights from ${weights.length} to 3 (kept: ${kept.join(',')})`);
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
      + `var _noop={progress:function(){return _noop;},kill:function(){},pause:function(){return _noop;},play:function(){return _noop;},reverse:function(){return _noop;},restart:function(){return _noop;},duration:function(){return 0;},scrollTrigger:null};`
      + `if(window.ScrollTrigger){var _stC=ScrollTrigger.create.bind(ScrollTrigger);ScrollTrigger.create=function(v){if(!v||v.trigger==null)return _noop;return _stC(v);};}`
      + `if(window.gsap){['to','from','fromTo','set'].forEach(function(fn){var _o=gsap[fn].bind(gsap);gsap[fn]=function(){if(arguments[0]==null)return _noop;return _o.apply(gsap,arguments);};});}`;
    fixed = fixed.replace(
      /document\.addEventListener\(['"]DOMContentLoaded['"],\s*function\s*\(\)\s*\{/,
      `document.addEventListener('DOMContentLoaded', function () {\n  ${guard}`
    );
    fixes.push('Injected GSAP null-target guard');
  }

  // ── 7. Safety reveal for broken GSAP animations ───────────────────────
  // Don't remove CSS opacity:0 — Sonnet uses it as initial state for reveal animations.
  // Instead, inject a fallback that reveals elements still stuck at opacity:0 after 5s.
  const hasGsap = /gsap\b/.test(fixed);
  if (hasGsap && !fixed.includes('__safetyReveal')) {
    const safetyScript = `
<script>
/* [auto-fix] __safetyReveal */
(function(){
  var t=setTimeout(function(){
    var skip=/mobile|menu|modal|overlay|cursor|hamburger|hidden|hp/i;
    document.querySelectorAll('[data-section] h1,[data-section] h2,[data-section] h3,[data-section] p,[data-section] img,[data-section] a,[data-section] li,[data-section] div').forEach(function(el){
      if(getComputedStyle(el).opacity==='0'&&!skip.test(el.className||'')&&!skip.test(el.id||'')){
        el.style.transition='opacity 0.6s ease';el.style.opacity='1';
      }
    });
    document.querySelectorAll('[data-section]').forEach(function(s){
      if(getComputedStyle(s).opacity==='0'){s.style.transition='opacity 0.6s ease';s.style.opacity='1';}
    });
  },5000);
  window.addEventListener('beforeunload',function(){clearTimeout(t);});
})();
</script>`;
    const bodyCloseReveal = fixed.lastIndexOf('</body>');
    if (bodyCloseReveal !== -1) {
      fixed = fixed.slice(0, bodyCloseReveal) + safetyScript + '\n' + fixed.slice(bodyCloseReveal);
      fixes.push('Injected safety-reveal fallback (catches broken GSAP animations after 5s)');
    }
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
  // Use global replace to patch ALL matching CSS rules, not just the first
  const menuClassPattern = /\.(mobile-menu|mob-menu|mob|nav-overlay|mobile-nav|sidebar-menu|hamburger-menu|nav-menu|slide-menu|offcanvas)\s*\{([^}]*)\}/gi;
  fixed = fixed.replace(menuClassPattern, function(match, _cls, body) {
    if (!body.includes('pointer-events')) {
      fixes.push('Added pointer-events:none to closed mobile menu');
      return match.replace('{', '{ pointer-events: none; ');
    }
    return match;
  });
  // And ensure .open state has pointer-events:all (global)
  const menuOpenPattern = /\.(mobile-menu|mob-menu|mob|nav-overlay|mobile-nav|sidebar-menu|hamburger-menu|nav-menu|slide-menu|offcanvas)\.open\s*\{([^}]*)\}/gi;
  fixed = fixed.replace(menuOpenPattern, function(match, _cls, body) {
    if (!body.includes('pointer-events')) {
      fixes.push('Added pointer-events:all to open mobile menu');
      return match.replace('{', '{ pointer-events: all; ');
    }
    return match;
  });

  // ── 12. (Removed) Section overflow clipping ────────────────────────
  // Previously added overflow:hidden to all [data-section] containers,
  // but this destroyed intentional creative bleeds (parallax, oversized
  // typography, cross-section animations). The system prompt now instructs
  // Sonnet to manage overflow per-section when needed.

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
