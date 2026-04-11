import puppeteer from 'puppeteer';
import fs from 'fs';

const OUT = '/tmp/site-check4';
fs.mkdirSync(OUT, { recursive: true });

const browser = await puppeteer.launch({ headless: true, args: ['--no-sandbox'] });

async function inspect(label, url) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900 });
  console.log(`\n=== ${label} ===`);

  await page.goto(url, { waitUntil: 'networkidle0', timeout: 30000 });
  await new Promise(r => setTimeout(r, 2500));

  // Screenshot before scroll
  await page.screenshot({ path: `${OUT}/${label}-1-before-scroll.png`, fullPage: false });

  // Slow scroll
  await page.evaluate(async () => {
    await new Promise(resolve => {
      let pos = 0;
      const id = setInterval(() => {
        window.scrollBy(0, 200);
        pos += 200;
        if (pos >= document.body.scrollHeight) { clearInterval(id); resolve(); }
      }, 150);
    });
    window.scrollTo(0, 0);
  });
  await new Promise(r => setTimeout(r, 1000));

  // Screenshot after scroll
  await page.screenshot({ path: `${OUT}/${label}-2-after-scroll.png`, fullPage: false });
  await page.screenshot({ path: `${OUT}/${label}-3-full.png`, fullPage: true });

  const details = await page.evaluate(() => {
    // Hero section details
    const hero = document.querySelector('.hero');
    const heroH2 = document.querySelector('.hero h2');
    const heroSub = document.querySelector('.hero .sub-title');
    const heroBtn = document.querySelector('.hero .hero-btn');

    function elInfo(el) {
      if (!el) return 'NOT FOUND';
      const s = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        opacity: s.opacity,
        visibility: s.visibility,
        display: s.display,
        transform: s.transform,
        classes: el.className,
        height: Math.round(r.height),
        top: Math.round(r.top),
        text: el.textContent?.slice(0, 60),
      };
    }

    // Check all sections heights
    const sections = [...document.querySelectorAll('section')].map((s, i) => ({
      i, classes: s.className.slice(0, 50),
      h: Math.round(s.getBoundingClientRect().height),
      bg: getComputedStyle(s).backgroundColor,
    }));

    // CSS loaded fonts
    const bodyFont = getComputedStyle(document.body).fontFamily?.slice(0, 60);

    return {
      hero: elInfo(hero),
      heroH2: elInfo(heroH2),
      heroSub: elInfo(heroSub),
      heroBtn: elInfo(heroBtn),
      sections,
      bodyFont,
      bodyBg: getComputedStyle(document.body).backgroundColor,
    };
  });

  console.log('body bg:', details.bodyBg);
  console.log('body font:', details.bodyFont);
  console.log('\nHero section:', JSON.stringify(details.hero, null, 2));
  console.log('Hero h2:', JSON.stringify(details.heroH2, null, 2));
  console.log('\nSections:');
  details.sections.forEach(s => console.log(`  [${s.i}] h:${s.h}px bg:${s.bg} — ${s.classes}`));

  await page.close();
}

await inspect('local', 'http://localhost:4321/');
await inspect('vercel', 'https://grappes.ai/');

await browser.close();
console.log(`\nScreenshots in ${OUT}`);
