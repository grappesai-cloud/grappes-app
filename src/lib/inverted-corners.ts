// ─── Inverted Corners Runtime ─────────────────────────────────────────────────
// Generates responsive clip-path shapes with concave (inverted) corners.
// Injected into pages where Haiku design spec enables it.
// Sonnet calls window.__invertCorners(element, { tl, tr, bl, br }) in section scripts.
//
// Uses clip-path: path() with ResizeObserver — recalculates on every resize.
// Radius values are in px — the function normalizes them to actual dimensions.

// ─── SVG path builder (pure TypeScript — used server-side for SSR or testing) ─

export function buildInvertedCornersPath(
  W: number,
  H: number,
  corners: { tl?: number; tr?: number; bl?: number; br?: number }
): string {
  const tl = corners.tl ?? 0;
  const tr = corners.tr ?? 0;
  const br = corners.br ?? 0;
  const bl = corners.bl ?? 0;

  // Clamp radii so they never exceed half the dimension
  const maxR = Math.min(W, H) / 2;
  const r = {
    tl: Math.min(tl, maxR),
    tr: Math.min(tr, maxR),
    br: Math.min(br, maxR),
    bl: Math.min(bl, maxR),
  };

  // Build SVG path — inverted corners use sweep-flag=0 (counter-clockwise arc)
  // which curves inward instead of outward
  const p: string[] = [];

  // Start top-left
  p.push(`M ${r.tl},0`);

  // Top edge → top-right
  p.push(`L ${W - r.tr},0`);
  if (r.tr > 0) {
    // Inverted arc: enters the element
    p.push(`A ${r.tr},${r.tr} 0 0 0 ${W},${r.tr}`);
  } else {
    p.push(`L ${W},0`);
  }

  // Right edge → bottom-right
  p.push(`L ${W},${H - r.br}`);
  if (r.br > 0) {
    p.push(`A ${r.br},${r.br} 0 0 0 ${W - r.br},${H}`);
  } else {
    p.push(`L ${W},${H}`);
  }

  // Bottom edge → bottom-left
  p.push(`L ${r.bl},${H}`);
  if (r.bl > 0) {
    p.push(`A ${r.bl},${r.bl} 0 0 0 0,${H - r.bl}`);
  } else {
    p.push(`L 0,${H}`);
  }

  // Left edge → top-left
  p.push(`L 0,${r.tl}`);
  if (r.tl > 0) {
    p.push(`A ${r.tl},${r.tl} 0 0 0 ${r.tl},0`);
  } else {
    p.push(`L 0,0`);
  }

  p.push('Z');
  return p.join(' ');
}

// ─── Browser runtime (injected as inline <script> into generated pages) ───────
// Self-contained IIFE — no imports, no framework dependencies.

export const INVERTED_CORNERS_JS = `(function(){
  function buildPath(W,H,tl,tr,br,bl){
    var maxR=Math.min(W,H)/2;
    tl=Math.min(tl,maxR); tr=Math.min(tr,maxR);
    br=Math.min(br,maxR); bl=Math.min(bl,maxR);
    var p=[];
    p.push('M '+tl+',0');
    p.push('L '+(W-tr)+',0');
    if(tr>0) p.push('A '+tr+','+tr+' 0 0 0 '+W+','+tr);
    else p.push('L '+W+',0');
    p.push('L '+W+','+(H-br));
    if(br>0) p.push('A '+br+','+br+' 0 0 0 '+(W-br)+','+H);
    else p.push('L '+W+','+H);
    p.push('L '+bl+','+H);
    if(bl>0) p.push('A '+bl+','+bl+' 0 0 0 0,'+(H-bl));
    else p.push('L 0,'+H);
    p.push('L 0,'+tl);
    if(tl>0) p.push('A '+tl+','+tl+' 0 0 0 '+tl+',0');
    else p.push('L 0,0');
    p.push('Z');
    return p.join(' ');
  }

  window.__invertCorners=function(el,corners){
    if(!el) return;
    var tl=corners.tl||0, tr=corners.tr||0,
        br=corners.br||0, bl=corners.bl||0;

    function apply(){
      var W=el.offsetWidth, H=el.offsetHeight;
      if(!W||!H) return;
      el.style.clipPath='path("'+buildPath(W,H,tl,tr,br,bl)+'")';
      el.style.webkitClipPath=el.style.clipPath;
    }

    // Apply immediately + on every resize
    apply();
    if(typeof ResizeObserver!=='undefined'){
      new ResizeObserver(apply).observe(el);
    } else {
      window.addEventListener('resize',apply);
    }
  };
})();`;

// ─── Sonnet documentation (injected into Sonnet's system prompt) ──────────────

export const INVERTED_CORNERS_DOCS = `
INVERTED CORNERS — available for this project:
window.__invertCorners(element, { tl, tr, bl, br })
  - tl/tr/bl/br = radius in px for each corner (0 = normal corner, omit to skip)
  - Creates a concave/inverted corner effect — the corner curves INWARD instead of outward
  - Fully responsive — recalculates on resize via ResizeObserver
  - Use in a <script> tag at the end of any section

USAGE EXAMPLE:
<script>
  (function() {
    var el = document.querySelector('[data-section="hero"]');
    window.__invertCorners(el, { bl: 80, br: 80 }); // both bottom corners inverted
  })();
</script>

CREATIVE GUIDANCE:
- Bold/dramatic: large radii 80-120px on hero bottom corners to create a scalloped edge
- Subtle/elegant: single corner 40-60px as a signature motif
- Cards: 30-50px on one corner (tl or tr) for editorial feel
- CTA section: all 4 corners for a pill-like dramatic shape (40-60px)
- NEVER invert all 4 corners with large radii — pick 1-2 corners max per element
- Echo the same corner position across 2-3 sections for visual consistency
- Works best on sections with solid or gradient backgrounds, NOT on sections with images`;
