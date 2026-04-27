/**
 * html-compat.ts
 *
 * Slim compatibility layer — contains only the functions from the old
 * html-generation.ts that are still imported by preview, publish, and tweak.
 * The heavy generation logic now lives in creative-generation.ts.
 */

import type { SiteArch } from './generation';

// ─── Constants ──────────────────────────────────────────────────────────────

export const HTML_KEY_PREFIX       = '__html__';
export const FULL_PAGE_KEY         = '__html__full';
export const INNER_FULL_KEY_PREFIX = '__html__full_';

// ─── addDataSectionAttributes ────────────────────────────────────────────────
// Sonnet generates <section class="hero"> without data-section attributes.
// This function adds data-section="<id>" to every <section> tag that lacks one,
// deriving the id from: id attribute → first class → index fallback.

function deriveSectionId(attrs: string, fallback: string): string {
  const idMatch    = attrs.match(/\bid\s*=\s*["']([^"']+)["']/i);
  const classMatch = attrs.match(/\bclass\s*=\s*["']([^"']+)["']/i);
  if (idMatch) return idMatch[1].trim().toLowerCase().replace(/[^a-z0-9-]/g, '-');
  if (classMatch) {
    const classes = classMatch[1].trim().split(/\s+/);
    const best = classes.find(c => c.length > 2 && !/^\d/.test(c)) ?? classes[0];
    return best.toLowerCase().replace(/[^a-z0-9-]/g, '-');
  }
  return fallback;
}

function addDataSectionAttributes(html: string): string {
  let idx = 0;

  // Add/fix data-section on <section> tags
  html = html.replace(/<section\b([^>]*)>/gi, (match, attrs) => {
    // Already has a meaningful data-section — leave as-is
    const existing = attrs.match(/\bdata-section\s*=\s*["']([^"']*)["']/i);
    if (existing && existing[1] && existing[1] !== 'full') return match;

    const sectionId = deriveSectionId(attrs, `section-${++idx}`);
    if (existing) {
      // Replace the 'full' (or empty) value with the real ID
      return match.replace(/\bdata-section\s*=\s*["'][^"']*["']/, `data-section="${sectionId}"`);
    }
    return `<section${attrs} data-section="${sectionId}">`;
  });

  // Also tag <nav> and <footer> if they don't have data-section yet
  html = html.replace(/<nav\b([^>]*)>/gi, (match, attrs) => {
    if (/\bdata-section\s*=/.test(attrs)) return match;
    return `<nav${attrs} data-section="nav">`;
  });
  html = html.replace(/<footer\b([^>]*)>/gi, (match, attrs) => {
    if (/\bdata-section\s*=/.test(attrs)) return match;
    return `<footer${attrs} data-section="footer">`;
  });

  return html;
}

// ─── stripLenisFromHtml ─────────────────────────────────────────────────────
// Edit mode only. Lenis (smooth-scroll lib) attaches wheel/touch listeners with
// preventDefault and replaces native scroll with translateY transforms — both
// break iframe interaction in the editor. We rip it out at three levels:
//   1. <script src="…lenis…"> CDN tags (the most common install pattern)
//   2. inline `new Lenis(...)` constructor calls (replaced with a no-op object)
//   3. inline `lenis.raf(...)` / `lenis.on(...)` references that would now
//      reference the no-op object (safe — they become no-ops too)
// The head stub `window.Lenis = Stub` injected separately handles ESM imports
// and any pattern we miss here.
export function stripLenisFromHtml(html: string): string {
  // 1. Remove CDN script tags
  let out = html.replace(/<script[^>]*src=["'][^"']*lenis[^"']*["'][^>]*>\s*<\/script>/gi, '<!-- lenis stripped (edit mode) -->');

  // 2. Replace `new Lenis(...)` with a no-op stub literal — neutralises the instance.
  //    `on('scroll', cb)` is wired to native window scroll so ScrollTrigger.update
  //    keeps firing. raf/start/stop are no-ops; native scroll is in charge now.
  const noopLiteral = '({destroy:function(){},on:function(e,c){if(e==="scroll"&&typeof c==="function")window.addEventListener("scroll",function(){try{c(this);}catch(_){}}, {passive:true});return this;},off:function(){return this;},raf:function(){},start:function(){},stop:function(){},resize:function(){if(window.ScrollTrigger&&window.ScrollTrigger.refresh)window.ScrollTrigger.refresh();},scrollTo:function(t,o){var y=0;if(typeof t==="number")y=t;else if(t&&t.nodeType===1){var r=t.getBoundingClientRect();y=r.top+window.pageYOffset+((o&&o.offset)||0);}window.scrollTo(0,y);}})';
  out = out.replace(/new\s+Lenis\s*\([^)]*\)/g, noopLiteral);

  return out;
}

// ─── injectWnIds ────────────────────────────────────────────────────────────
// Adds stable `data-wn-id` attributes to all editable leaf elements.
// IDs are short deterministic counters (wn-0001, wn-0002, …).
// Safe to call multiple times — skips if IDs already present.

const EDITABLE_TAGS = 'h1|h2|h3|h4|h5|h6|p|a|button|li|label|blockquote|figcaption|td|th|img|span|small|strong|em|b|i|u|mark|cite|time|address|dt|dd|caption|legend|summary|div';

export function injectWnIds(html: string): string {
  // Find highest existing wn-id counter to avoid duplicates
  let counter = 0;
  html.replace(/data-wn-id="wn-([a-z0-9]+)"/g, (_, id) => {
    const n = parseInt(id, 36);
    if (n > counter) counter = n;
    return '';
  });
  const genId = () => 'wn-' + (++counter).toString(36).padStart(4, '0');

  return html.replace(
    new RegExp(`<(${EDITABLE_TAGS})\\b([^>]*)>`, 'gi'),
    (match, tag, attrs) => {
      if (/data-wn-id\s*=/.test(attrs)) return match;
      const id = genId();
      // Handle self-closing tags like <img ... />
      if (/\/\s*$/.test(attrs)) {
        return `<${tag}${attrs.replace(/\/\s*$/, '')} data-wn-id="${id}" />`;
      }
      return `<${tag}${attrs} data-wn-id="${id}">`;
    },
  );
}

// ─── injectEditModeIntoFullPage ─────────────────────────────────────────────

export function injectEditModeIntoFullPage(fullHtml: string): string {
  fullHtml = addDataSectionAttributes(fullHtml);
  fullHtml = injectWnIds(fullHtml);
  fullHtml = stripLenisFromHtml(fullHtml);

  const editCss = `
    * { box-sizing: border-box; }

    /* Force native scroll in edit mode — Lenis sets overflow:hidden which breaks iframe */
    html, body { overflow: auto !important; scroll-behavior: auto !important; }

    /* Hover highlight */
    #__wn_highlight__ {
      position: fixed; pointer-events: none; z-index: 99998;
      border: 2px solid #7c3aed; background: rgba(124,58,237,0.06);
      transition: all 0.08s ease; border-radius: 2px; display: none;
    }
    #__wn_label__ {
      position: fixed; z-index: 99999; pointer-events: none; display: none;
      background: #7c3aed; color: #fff;
      padding: 2px 8px; border-radius: 3px;
      font: 600 11px/18px system-ui; white-space: nowrap;
    }

    /* Selected element */
    #__wn_selected__ {
      position: fixed; pointer-events: none; z-index: 99997;
      border: 2px solid #7c3aed; background: rgba(124,58,237,0.10);
      border-radius: 2px; display: none;
    }

    /* Image edit overlay */
    #__wn_img_overlay__ {
      position: fixed; z-index: 99999; display: none;
      background: rgba(0,0,0,0.6); border-radius: 4px;
      flex-direction: column; align-items: center; justify-content: center; gap: 8px;
      cursor: pointer;
    }
    #__wn_img_overlay__ .wn-img-icon {
      width: 40px; height: 40px; border-radius: 50%;
      background: #7c3aed; color: #fff;
      display: flex; align-items: center; justify-content: center;
      font-size: 20px; font-weight: bold;
    }
    #__wn_img_overlay__ .wn-img-text {
      color: #fff; font: 600 13px/1 system-ui;
      text-shadow: 0 1px 4px rgba(0,0,0,0.5);
    }`;

  const editScript = `
  (function(){
    // Kill Lenis smooth scroll in edit mode — it breaks iframe scrolling
    if(window.lenis){try{window.lenis.destroy();}catch(e){}}
    document.documentElement.style.setProperty('overflow','auto','important');
    document.body.style.setProperty('overflow','auto','important');

    // Reset ScrollTrigger to native scroll AFTER the page's own setup runs.
    // Sonnet often wires ScrollTrigger.scrollerProxy(...) to Lenis — that proxy
    // stops returning real scroll positions once we neutralise Lenis.
    function resetScrollTrigger(){
      if(!window.ScrollTrigger)return;
      try{
        if(typeof window.ScrollTrigger.scrollerProxy==='function')
          window.ScrollTrigger.scrollerProxy(document.documentElement);
        if(typeof window.ScrollTrigger.normalizeScroll==='function')
          window.ScrollTrigger.normalizeScroll(false);
        if(typeof window.ScrollTrigger.refresh==='function')
          window.ScrollTrigger.refresh();
      }catch(e){if(window.console)console.warn('[edit-mode] ScrollTrigger reset failed:',e);}
    }
    if(document.readyState==='complete')setTimeout(resetScrollTrigger,200);
    else window.addEventListener('load',function(){setTimeout(resetScrollTrigger,200);});

    // Force-reveal pass for edit mode. Sonnet generates lots of scroll-triggered
    // entrance animations (opacity:0 → 1 via GSAP/IntersectionObserver). Inside
    // an iframe those triggers often miss — viewport math is off, ScrollTrigger
    // attaches before our scroller proxy resets, IntersectionObserver fires
    // late or never. Result: DOM is intact (sections clickable, text editable)
    // but the page looks empty because most elements are stuck at opacity 0.
    // After a short grace period, walk the DOM and unstick anything still
    // invisible so the editor is usable. Skips overlay helpers (#__wn_*).
    function forceReveal(){
      var changed = 0;
      document.querySelectorAll('body *:not([id^="__wn_"])').forEach(function(el){
        var cs = getComputedStyle(el);
        if (cs.opacity === '0' && el.offsetWidth > 0 && el.offsetHeight > 0) {
          el.style.setProperty('opacity', '1', 'important');
          // Common entrance transforms (translateY/translateX/scale) — neutralize too
          if (cs.transform && cs.transform !== 'none' && cs.transform !== 'matrix(1, 0, 0, 1, 0, 0)') {
            el.style.setProperty('transform', 'none', 'important');
          }
          if (cs.visibility === 'hidden') el.style.setProperty('visibility', 'visible', 'important');
          if (cs.clipPath && cs.clipPath !== 'none' && cs.clipPath !== 'inset(0)') {
            el.style.setProperty('clip-path', 'none', 'important');
          }
          changed++;
        }
      });
      if (changed > 0 && window.console) console.log('[edit-mode] force-revealed', changed, 'stuck elements');
    }
    // First pass shortly after load — gives normal animations a chance to play.
    function scheduleForceReveal(){ setTimeout(forceReveal, 1800); setTimeout(forceReveal, 4000); }
    if (document.readyState === 'complete') scheduleForceReveal();
    else window.addEventListener('load', scheduleForceReveal);

    var TEXT_TAGS = {h1:1,h2:1,h3:1,h4:1,h5:1,h6:1,p:1,a:1,button:1,li:1,label:1,blockquote:1,figcaption:1,td:1,th:1,span:1,small:1,strong:1,em:1,b:1,i:1,u:1,mark:1,cite:1,time:1,address:1,dt:1,dd:1,caption:1,legend:1,summary:1,div:1};
    var editing = false;
    var editingEl = null;
    var originalContent = '';
    var bgMode = false;

    // Click cycling: track stack of elements at click point
    var cycleStack = [];  // array of wn-id elements at last click position
    var cycleIndex = -1;
    var lastClickX = -1, lastClickY = -1;
    var CLICK_TOLERANCE = 5; // px — same spot if within this radius

    // ── Overlay elements ──────────────────────────────────────────────────
    var hl   = document.createElement('div'); hl.id   = '__wn_highlight__';
    var lbl  = document.createElement('div'); lbl.id  = '__wn_label__';
    var sel  = document.createElement('div'); sel.id  = '__wn_selected__';
    var imgOv = document.createElement('div'); imgOv.id = '__wn_img_overlay__';
    imgOv.innerHTML = '<div class="wn-img-icon">📷</div><div class="wn-img-text">Change image</div>';
    [hl, lbl, sel, imgOv].forEach(function(el){ document.body.appendChild(el); });

    var imgOverlayTarget = null;
    var imgPromptTimer = null;

    imgOv.addEventListener('click', function(e) {
      e.preventDefault(); e.stopPropagation();
      if (!imgOverlayTarget) return;
      // Tell parent to open image dialog
      window.parent.postMessage({
        type: 'wn-request-image',
        wnId: imgOverlayTarget.dataset.wnId,
        currentSrc: imgOverlayTarget.src || '',
      }, '*');
      // Fallback: if parent doesn't ack within 400ms, use prompt
      var target = imgOverlayTarget;
      imgPromptTimer = setTimeout(function() {
        if (imgOv.style.display !== 'none') {
          var url = prompt('URL imagine nouă:', target.src || '');
          if (url && url.trim()) {
            target.src = url.trim();
            window.parent.postMessage({
              type: 'wn-edit',
              wnId: target.dataset.wnId,
              prop: 'src',
              value: url.trim(),
            }, '*');
          }
          hideImageOverlay();
        }
      }, 400);
    });

    function posBox(box, el) {
      el.style.top    = box.top  + 'px';
      el.style.left   = box.left + 'px';
      el.style.width  = box.width  + 'px';
      el.style.height = box.height + 'px';
    }

    function hideAll() { hl.style.display = lbl.style.display = sel.style.display = 'none'; }

    function getEditable(el) {
      if (!el) return null;
      if (el.dataset && el.dataset.wnId) return el;
      return el.closest('[data-wn-id]');
    }

    function elType(el) {
      var tag = el.tagName.toLowerCase();
      if (tag === 'img') return 'image';
      if (TEXT_TAGS[tag]) return 'text';
      return 'container';
    }

    var TYPE_LABELS = { text: '✎ Text', image: '🖼 Image', container: '◼ Style' };

    // CSS selector for legacy dashboard compatibility
    function getSelector(el) {
      var parts = [];
      var cur = el;
      var section = el.closest('[data-section]');
      while (cur && cur !== section) {
        var tag = cur.tagName.toLowerCase();
        var id = cur.id ? '#' + cur.id : '';
        var cls = '';
        if (!id && cur.className && typeof cur.className === 'string') {
          var classes = cur.className.trim().split(/\\s+/).filter(function(c){ return c && !c.startsWith('__'); });
          if (classes.length) cls = '.' + classes.slice(0,2).join('.');
        }
        parts.unshift(tag + (id || cls));
        if (id) break;
        cur = cur.parentElement;
      }
      var base = section ? '[data-section="' + section.dataset.section + '"]' : '';
      return base + (parts.length ? ' ' + parts.join(' > ') : '');
    }

    function getFonts() {
      var fonts = new Set();
      try {
        document.querySelectorAll('link[href*="fonts.googleapis.com"]').forEach(function(link) {
          var m = link.href.match(/family=([^&]+)/);
          if (m) m[1].split('|').forEach(function(f) { fonts.add(f.split(':')[0].replace(/\\+/g, ' ')); });
        });
        document.querySelectorAll('style').forEach(function(s) {
          var ff = s.textContent.match(/font-family:\\s*['"]?([^;'"}\\n]+)/gi);
          if (ff) ff.forEach(function(f) {
            var name = f.replace(/font-family:\\s*/i, '').replace(/['"]/g, '').trim().split(',')[0].trim();
            if (name && name.length > 1 && !/^(inherit|initial|unset|sans-serif|serif|monospace)$/i.test(name)) fonts.add(name);
          });
        });
      } catch(e){}
      return Array.from(fonts);
    }

    function getSection(el) {
      if (!el) return null;
      return el.closest('[data-section]');
    }

    // Find the background image within a section (could be on section, child div, or absolute img)
    function findSectionBgImage(section) {
      // Check the section itself
      var bg = getComputedStyle(section).backgroundImage;
      if (bg && bg !== 'none') return { type: 'css', value: bg, el: section };
      // Check descendants for background-image
      var children = section.querySelectorAll('*');
      for (var i = 0; i < children.length; i++) {
        var child = children[i];
        // Skip our overlay elements
        if (child.id && child.id.startsWith('__wn')) continue;
        var cs = getComputedStyle(child);
        // CSS background-image on a div/container
        if (cs.backgroundImage && cs.backgroundImage !== 'none') {
          return { type: 'css', value: cs.backgroundImage, el: child };
        }
      }
      // Check for absolute/fixed positioned <img> acting as background
      var imgs = section.querySelectorAll('img');
      for (var j = 0; j < imgs.length; j++) {
        var img = imgs[j];
        var ics = getComputedStyle(img);
        if (ics.position === 'absolute' || ics.position === 'fixed') {
          return { type: 'img', value: img.src, el: img };
        }
        // Also check if img covers most of the section (object-fit: cover pattern)
        if (ics.objectFit === 'cover' && img.offsetWidth > section.offsetWidth * 0.5) {
          return { type: 'img', value: img.src, el: img };
        }
      }
      return null;
    }

    // Walk up DOM to find effective (non-transparent) background color
    function getEffectiveBg(el) {
      var cur = el;
      while (cur && cur !== document.documentElement) {
        var bg = getComputedStyle(cur).backgroundColor;
        if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') return bg;
        cur = cur.parentElement;
      }
      return 'rgb(0, 0, 0)';
    }

    // ── Hover ─────────────────────────────────────────────────────────────
    document.addEventListener('mousemove', function(e) {
      if (editing) return;
      var raw = document.elementFromPoint(e.clientX, e.clientY);

      if (bgMode) {
        var sec = getSection(raw);
        if (!sec || (sec.id && sec.id.startsWith('__wn'))) { hl.style.display = lbl.style.display = 'none'; return; }
        var box = sec.getBoundingClientRect();
        posBox(box, hl); hl.style.display = 'block';
        lbl.textContent = '🎨 ' + (sec.dataset.section || 'section');
        lbl.style.display = 'block';
        var lt = box.top - 22;
        lbl.style.top  = (lt < 4 ? box.bottom + 4 : lt) + 'px';
        lbl.style.left = box.left + 'px';
        return;
      }

      var el = getEditable(raw);
      if (!el || (el.id && el.id.startsWith('__wn')) || el.closest('#__wn_img_overlay__')) { hl.style.display = lbl.style.display = 'none'; return; }

      var box = el.getBoundingClientRect();
      if (box.width < 2 || box.height < 2) return;

      posBox(box, hl); hl.style.display = 'block';

      var type = elType(el);
      lbl.textContent = TYPE_LABELS[type] || el.tagName.toLowerCase();
      lbl.style.display = 'block';
      var lt = box.top - 22;
      lbl.style.top  = (lt < 4 ? box.bottom + 4 : lt) + 'px';
      lbl.style.left = box.left + 'px';
    });

    // ── Click — select element, tell parent ───────────────────────────────
    document.addEventListener('click', function(e) {
      if (editing) return;

      // Always clear previous image overlay on any click
      hideImageOverlay();

      // Background mode: select section
      if (bgMode) {
        var sec = getSection(document.elementFromPoint(e.clientX, e.clientY));
        if (!sec) {
          sel.style.display = 'none';
          window.parent.postMessage({ type: 'wn-deselect' }, '*');
          return;
        }
        e.preventDefault();
        var box = sec.getBoundingClientRect();
        posBox(box, sel); sel.style.display = 'block';
        hl.style.display = lbl.style.display = 'none';
        var bgInfo = findSectionBgImage(sec);
        window.parent.postMessage({
          type: 'wn-select-section',
          sectionId: sec.dataset.section || '',
          bgColor: getEffectiveBg(sec),
          bgImage: bgInfo ? bgInfo.value : 'none',
          bgImageType: bgInfo ? bgInfo.type : null,
          bgImageWnId: (bgInfo && bgInfo.el.dataset && bgInfo.el.dataset.wnId) || null,
        }, '*');
        return;
      }

      // Build stack of all wn-id elements at this click point
      var sameSpot = Math.abs(e.clientX - lastClickX) < CLICK_TOLERANCE && Math.abs(e.clientY - lastClickY) < CLICK_TOLERANCE;
      lastClickX = e.clientX; lastClickY = e.clientY;

      if (!sameSpot) {
        // New spot — rebuild stack
        var allAtPoint = document.elementsFromPoint(e.clientX, e.clientY);
        cycleStack = [];
        var seen = {};
        for (var i = 0; i < allAtPoint.length; i++) {
          var candidate = getEditable(allAtPoint[i]);
          if (candidate && candidate.dataset.wnId && !seen[candidate.dataset.wnId]) {
            seen[candidate.dataset.wnId] = true;
            cycleStack.push(candidate);
          }
        }
        cycleIndex = 0;
      } else {
        // Same spot — cycle to next element in stack
        cycleIndex = (cycleIndex + 1) % (cycleStack.length || 1);
      }

      var el = cycleStack[cycleIndex];
      if (!el) {
        // Clicked empty space — deselect everything
        sel.style.display = 'none';
        cycleStack = []; cycleIndex = -1;
        window.parent.postMessage({ type: 'wn-deselect' }, '*');
        window.parent.postMessage({ type: 'element-deselect' }, '*');
        return;
      }
      e.preventDefault();

      var box = el.getBoundingClientRect();
      posBox(box, sel); sel.style.display = 'block';
      hl.style.display = lbl.style.display = 'none';

      var type = elType(el);
      var section = el.closest('[data-section]');

      var cs = getComputedStyle(el);
      var tag = el.tagName.toLowerCase();
      var sectionId = section ? section.dataset.section : null;
      var text = (el.textContent || '').trim().slice(0, 200);
      var outerHTML = el.outerHTML.slice(0, 2000);

      // New visual editor message
      window.parent.postMessage({
        type:      'wn-select',
        wnId:      el.dataset.wnId,
        elType:    type,
        tag:       tag,
        text:      text,
        src:       el.src || el.style.backgroundImage || '',
        sectionId: sectionId,
        bgColor:   getEffectiveBg(el),
        color:     cs.color,
        fontSize:  Math.round(parseFloat(cs.fontSize)),
        fontWeight: cs.fontWeight,
        fontStyle:  cs.fontStyle,
        fontFamily: cs.fontFamily,
        textAlign:  cs.textAlign,
        fonts:     getFonts(),
        rect:      { top: box.top, left: box.left, width: box.width, height: box.height },
      }, '*');

      // Legacy message for dashboard overview page compatibility
      window.parent.postMessage({
        type:      'element-click',
        sectionId: sectionId,
        selector:  getSelector(el),
        tag:       tag,
        text:      text,
        outerHTML: outerHTML,
      }, '*');
    }, true);

    // ── Double-click — inline edit ────────────────────────────────────────
    document.addEventListener('dblclick', function(e) {
      if (bgMode) return;
      var el = getEditable(e.target);
      if (!el) return;
      e.preventDefault();

      var type = elType(el);

      if (type === 'text') {
        startTextEdit(el);
      } else if (type === 'image') {
        showImageOverlay(el);
      }
    }, true);

    function startTextEdit(el) {
      editing = true;
      editingEl = el;
      originalContent = el.innerHTML;
      el.contentEditable = 'true';
      el.style.outline = '2px solid #7c3aed';
      el.style.outlineOffset = '2px';
      window.focus();
      el.focus();
      sel.style.display = 'none';
      // Select all text
      try {
        var range = document.createRange();
        range.selectNodeContents(el);
        var s = window.getSelection();
        s.removeAllRanges(); s.addRange(range);
      } catch(e){}
    }

    function finishTextEdit(cancelled) {
      if (!editingEl) return;
      var el = editingEl;
      el.contentEditable = 'false';
      el.style.outline = '';
      el.style.outlineOffset = '';
      try { window.getSelection().removeAllRanges(); } catch(e){}
      if (!cancelled) {
        var newContent = el.innerHTML;
        if (newContent !== originalContent) {
          window.parent.postMessage({
            type: 'wn-edit', wnId: el.dataset.wnId, prop: 'innerHTML', value: newContent,
          }, '*');
        }
      } else {
        el.innerHTML = originalContent;
      }
      editing = false; editingEl = null; originalContent = '';
    }

    // Blur finishes edit
    document.addEventListener('focusout', function(e) {
      if (editing && editingEl && !editingEl.contains(e.relatedTarget)) {
        finishTextEdit(false);
      }
    });

    function showImageOverlay(el) {
      imgOverlayTarget = el;
      var box = el.getBoundingClientRect();
      imgOv.style.top    = box.top  + 'px';
      imgOv.style.left   = box.left + 'px';
      imgOv.style.width  = box.width  + 'px';
      imgOv.style.height = box.height + 'px';
      imgOv.style.display = 'flex';
      sel.style.display = 'none';
      // Also tell parent to prepare
      window.parent.postMessage({
        type: 'wn-request-image',
        wnId: el.dataset.wnId,
        currentSrc: el.src || '',
      }, '*');
    }

    function hideImageOverlay() {
      imgOv.style.display = 'none';
      imgOverlayTarget = null;
    }


    // ── Keyboard ──────────────────────────────────────────────────────────
    document.addEventListener('keydown', function(e) {
      if (e.key === 'Escape') {
        if (editing) { finishTextEdit(true); }
        sel.style.display = 'none';
        hideImageOverlay();
        window.parent.postMessage({ type: 'wn-deselect' }, '*');
        window.parent.postMessage({ type: 'element-deselect' }, '*');
      }
      if (e.key === 'Enter' && !e.shiftKey && editing) {
        e.preventDefault();
        finishTextEdit(false);
      }
    });

    // ── Messages from parent (origin-checked) ─────────────────────────────
    window.addEventListener('message', function(e) {
      if (!e.data) return;
      // Only accept messages from same origin (the platform editor)
      if (e.origin !== location.origin) return;

      // Background mode toggle
      if (e.data.type === 'wn-bg-mode') {
        bgMode = !!e.data.active;
        sel.style.display = 'none';
        hl.style.display = lbl.style.display = 'none';
        hideImageOverlay();
      }
      // Parent ack — cancel prompt fallbacks
      if (e.data.type === 'wn-image-dialog-ack') {
        clearTimeout(imgPromptTimer);
      }
      // Image update
      if (e.data.type === 'wn-update-image') {
        var img = document.querySelector('[data-wn-id="' + e.data.wnId + '"]');
        if (img) img.src = e.data.value;
        hideImageOverlay();
        clearTimeout(imgPromptTimer);
      }

      // Style update (color, background-color, font-size, etc.)
      if (e.data.type === 'wn-update-style') {
        var target = e.data.wnId
          ? document.querySelector('[data-wn-id="' + e.data.wnId + '"]')
          : document.querySelector('[data-section="' + e.data.sectionId + '"]');
        if (target) target.style[e.data.prop] = e.data.value;
      }

      // Text update from parent editor dialog
      if (e.data.type === 'wn-update-text') {
        var textTarget = e.data.wnId
          ? document.querySelector('[data-wn-id="' + e.data.wnId + '"]')
          : null;
        if (textTarget) textTarget.innerHTML = e.data.value;
      }

      // Section hot-swap (kept for AI iterate compatibility)
      if (e.data.type === 'update-section') {
        var existing = document.querySelector('[data-section="' + e.data.sectionId + '"]');
        if (!existing) return;
        var tmp = document.createElement('div');
        tmp.innerHTML = e.data.html;
        var newEl = tmp.firstElementChild;
        if (newEl) existing.replaceWith(newEl);
      }

      // Delete element by wn-id
      if (e.data.type === 'wn-delete') {
        var delEl = document.querySelector('[data-wn-id="' + e.data.wnId + '"]');
        if (delEl) delEl.remove();
      }

      // Delete entire section
      if (e.data.type === 'wn-delete-section') {
        var delSec = document.querySelector('[data-section="' + e.data.sectionId + '"]');
        if (delSec) delSec.remove();
        // Also remove section comment markers if any
      }

      if (e.data.type === 'set-active') {
        var t = document.querySelector('[data-section="' + e.data.sectionId + '"]');
        if (t) t.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }
    });

    // ── Announce sections ─────────────────────────────────────────────────
    function sendSections() {
      var ids = [];
      document.querySelectorAll('[data-section]').forEach(function(el) {
        var id = el.dataset.section;
        if (id && id !== 'full') ids.push(id);
      });
      window.parent.postMessage({ type: 'sections-ready', sectionIds: ids }, '*');
    }
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', sendSections);
    else sendSections();
    window.addEventListener('message', function(ev) {
      if (ev.data && ev.data.type === 'request-sections') sendSections();
    });
  })();`;

  // Stub window.Lenis BEFORE any other script runs, so generated `new Lenis()`
  // calls produce a no-op instance that doesn't capture wheel events.
  // This must be the first script in <head> to win the race against Lenis CDN.
  const lenisStub = `(function(){try{var noop=function(){};var listeners={};function Stub(){var self=this;this.destroy=noop;this.off=function(ev,cb){var arr=listeners[ev];if(!arr)return;var i=arr.indexOf(cb);if(i>=0)arr.splice(i,1);if(ev==='scroll'&&cb)window.removeEventListener('scroll',cb);};this.on=function(ev,cb){if(typeof cb!=='function')return self;listeners[ev]=listeners[ev]||[];listeners[ev].push(cb);if(ev==='scroll'){window.addEventListener('scroll',function(){try{cb(self);}catch(_){}},{passive:true});}return self;};this.raf=noop;this.start=noop;this.stop=noop;this.resize=function(){if(window.ScrollTrigger&&typeof window.ScrollTrigger.refresh==='function')window.ScrollTrigger.refresh();};this.scrollTo=function(t,o){var y=0;if(typeof t==='number')y=t;else if(t&&t.nodeType===1){var r=t.getBoundingClientRect();y=r.top+window.pageYOffset+((o&&o.offset)||0);}window.scrollTo(0,y);};return this;}var existing=Object.getOwnPropertyDescriptor(window,'Lenis');if(!existing||existing.configurable!==false){try{Object.defineProperty(window,'Lenis',{configurable:true,get:function(){return Stub;},set:function(){}});}catch(_){window.Lenis=Stub;}}else{window.Lenis=Stub;}window.lenis=new Stub();}catch(e){if(window&&window.console)console.warn('[edit-mode] Lenis neutralisation failed:',e);}})();`;

  return fullHtml
    .replace(/<head(\s[^>]*)?>/, (m) => `${m}\n  <script>${lenisStub}</script>`)
    .replace('</head>', `  <style>/* Edit mode */${editCss}</style>\n</head>`)
    .replace('</body>', `  <script>${editScript}</script>\n</body>`);
}

// ─── assemblePreviewPage (legacy — for old section-based projects) ──────────

export function assemblePreviewPage(params: {
  sectionHtmls: Record<string, string>;
  arch: SiteArch;
  editMode?: boolean;
  ogImage?: string;
  siteUrl?: string;
}): string {
  const { sectionHtmls, arch, editMode = false } = params;

  const sorted = Object.keys(sectionHtmls).sort();
  const navHtml    = sectionHtmls['nav']    ?? '';
  const footerHtml = sectionHtmls['footer'] ?? '';
  const mainHtml   = sorted
    .filter(id => id !== 'nav' && id !== 'footer')
    .map(id => sectionHtmls[id])
    .join('\n');

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${arch.businessName ?? 'Website'}</title>
</head>
<body>
${navHtml}
<main>
${mainHtml}
</main>
${footerHtml}
</body>
</html>`;

  return editMode ? injectEditModeIntoFullPage(html) : html;
}

// ─── buildStaticPublishFiles ────────────────────────────────────────────────

export function buildStaticPublishFiles(params: {
  sectionHtmls?: Record<string, string>;
  fullHtml?: string;
  arch: SiteArch;
  allFiles?: Record<string, string>;
  siteUrl?: string;
}): Record<string, string> {
  const { sectionHtmls = {}, fullHtml, arch, allFiles = {}, siteUrl } = params;
  const letter = (arch.businessName?.charAt(0) ?? '●').toUpperCase();
  const effectiveUrl = siteUrl || 'https://example.com';

  // Discover inner page slugs
  const innerSlugs: string[] = [];
  for (const key of Object.keys(allFiles)) {
    if (key.startsWith(INNER_FULL_KEY_PREFIX) && allFiles[key]) {
      innerSlugs.push(key.replace(INNER_FULL_KEY_PREFIX, ''));
    }
  }

  // Sitemap
  const sitemapUrls = [`  <url><loc>${effectiveUrl}/</loc><priority>1.0</priority></url>`];
  for (const slug of innerSlugs) {
    sitemapUrls.push(`  <url><loc>${effectiveUrl}/${slug}</loc><priority>0.8</priority></url>`);
  }
  const sitemapXml = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${sitemapUrls.join('\n')}\n</urlset>`;

  const output: Record<string, string> = {
    'index.html': fullHtml ?? assemblePreviewPage({ sectionHtmls, arch, editMode: false }),
    'favicon.svg': `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">
  <rect width="32" height="32" rx="8" fill="${arch.primaryColor ?? '#6366f1'}"/>
  <text x="16" y="22" text-anchor="middle" font-size="18" font-family="sans-serif" fill="white" font-weight="bold">${letter}</text>
</svg>`,
    'robots.txt': `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /preview/\n\nSitemap: ${effectiveUrl}/sitemap.xml`,
    'sitemap.xml': sitemapXml,
    'vercel.json': JSON.stringify({ cleanUrls: true, trailingSlash: false }, null, 2),
  };

  // Inner pages
  for (const [key, html] of Object.entries(allFiles)) {
    if (key.startsWith(INNER_FULL_KEY_PREFIX) && html) {
      output[`${key.replace(INNER_FULL_KEY_PREFIX, '')}.html`] = html;
    }
  }

  return output;
}
