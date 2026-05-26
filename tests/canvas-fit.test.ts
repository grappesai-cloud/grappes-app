import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'node:fs';
import { injectCanvasFit } from '../src/lib/creative-generation';

const buggyHero = `<!doctype html><html><head><meta charset="utf-8"><style>
*{margin:0} .hero{min-height:100vh;background:#0a0a0a;position:relative}
.hero h1{position:relative;z-index:2;color:#fff;padding:48px;font-family:sans-serif}
</style></head><body>
<section class="hero">
  <canvas id="bg"></canvas>
  <h1>Don't be boring.</h1>
</section>
<script>
  const cv=document.getElementById('bg'), ctx=cv.getContext('2d');
  function draw(){ ctx.clearRect(0,0,cv.width,cv.height); ctx.fillStyle='#3b82f6'; ctx.fillRect(0,0,cv.width,cv.height); requestAnimationFrame(draw); }
  draw();
</script>
</body></html>`;

describe('injectCanvasFit', () => {
  it('injects the safety-net script when a <canvas> is present', () => {
    const out = injectCanvasFit(buggyHero);
    expect(out).toContain('full-bleed canvas safety net');
    expect(out.indexOf('safety net')).toBeLessThan(out.lastIndexOf('</body>'));
    writeFileSync('/tmp/canvas-fit-fixture.html', out); // for the headless render check
  });

  it('is a no-op when there is no canvas', () => {
    const noCanvas = '<!doctype html><html><body><h1>hi</h1></body></html>';
    expect(injectCanvasFit(noCanvas)).toBe(noCanvas);
  });
});
