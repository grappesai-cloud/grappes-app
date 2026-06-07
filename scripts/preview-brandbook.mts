// Render a sample brand book to PDF + page screenshots for visual QA.
// Run: npx tsx scripts/preview-brandbook.mts
import puppeteer from 'puppeteer';
import { mkdirSync, writeFileSync } from 'node:fs';
import { renderBrandBookHTML } from '../src/lib/brandbook-template.ts';
import { renderAkriviHTML } from '../src/lib/brandbook-akrivi.ts';
import { DEFAULT_DONTS } from '../src/lib/brandbook-gen.ts';

const doc = {
  name: 'Nirakara',
  // WHITE mark on transparent bg (like the Grappes logo) → logoIsLight true.
  logoIsLight: true,
  logoUrl: 'data:image/svg+xml;base64,' + Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 64"><path fill="#ffffff" d="M0 64 L28 20 L52 20 L24 64 Z M40 64 L68 20 L92 20 L92 64 L68 64 L68 40 L52 64 Z"/></svg>`
  ).toString('base64'),
  typeface: 'Archivo',
  colors: [
    { hex: '#e25822', label: 'Terracotta' },
    { hex: '#1e3a8a', label: 'Deep Indigo' },
  ],
  donts: DEFAULT_DONTS,
  content: {
    tagline: 'Architecture rooted in culture',
    intro: [
      'Welcome to the Nirakara Brand Guidelines, designed to provide a comprehensive framework for representing our brand identity. These guidelines ensure consistency and coherence across all brand touchpoints, enabling us to communicate our values, personality, and unique offerings to our target audience.',
      'Our brand guidelines empower us to connect with our audience, establish a strong presence, and tell our unique story. By maintaining consistency and adhering to these guidelines, we cultivate trust, showcase our offerings, and foster loyalty.',
    ],
    about_statement: 'About the brand — Nirakara is an Indian boutique architecture firm that specializes in sustainable, innovative, and culturally reflective designs.',
    aim_statement: 'Our aim is to deliver innovative, bespoke solutions that exceed client expectations and embrace India’s rich heritage.',
    vision_statement: 'Our vision is to be a trailblazing force in sustainable and culturally reflective architectural design.',
    values: [
      { title: 'Environmental Consciousness', description: 'We prioritize sustainability and eco-friendly practices, utilizing renewable materials and sustainable design techniques to create structures that harmonize with nature.' },
      { title: 'Cultural Integrity', description: 'Blending tradition and modernity, our designs pay homage to India’s diverse cultural heritage, embracing craftsmanship and local aesthetics.' },
      { title: 'Innovation & Creativity', description: 'We continuously push the boundaries of architectural design, delivering unique and inspiring spaces that challenge norms and captivate the imagination.' },
      { title: 'Quality and Craftsmanship', description: 'Meticulous attention to detail and collaboration with skilled artisans result in architectural masterpieces showcasing the highest standards of quality.' },
    ],
    tone: [
      { title: 'Confident', description: 'Our tone reflects a sense of assurance and expertise in our field, showcasing our confidence in delivering exceptional architectural designs.' },
      { title: 'Inspirational', description: 'We aim to inspire and ignite creativity through our tone, encouraging clients and stakeholders to envision possibilities and embrace innovation.' },
      { title: 'Approachable', description: 'Our tone is warm, friendly, and inviting, fostering open communication and building strong relationships with clients and partners.' },
      { title: 'Knowledgeable', description: 'We convey our expertise and deep understanding of architectural principles, establishing ourselves as trusted authorities in the industry.' },
    ],
    logomark: [
      'Nirakara’s architectural brand is embodied in its logo, a sharp-edged N mark forming an intersecting and asymmetrical triangle in negative space.',
      'This design symbolizes our commitment to precision, innovation, and the seamless integration of contrasting elements. The interconnectedness of the logo’s parts represents our holistic approach to architecture.',
    ],
    logotype: [
      'Archivo, chosen as the logotype for Nirakara, captures the brand’s essence with its modern and sophisticated design. The font’s clean lines and balanced proportions create a visually pleasing and easily recognizable logo.',
      'This versatile and free-for-commercial-use font lends a contemporary edge to the brand’s visual communication, ensuring consistency and legibility across platforms.',
    ],
    lockup: 'This combination of the logomark and logotype ensures a consistent and recognizable representation of the brand across various applications and reinforces Nirakara’s commitment to delivering exceptional design solutions.',
    clear_space: 'A minimum clear space equal to the height of the logomark must surround the logo at all times, keeping it legible and free from competing visual elements.',
    minimum_sizes: 'The logo is optimized for sizes that are not excessively small. It mandates a minimum height of .75 inch for print applications and 50px for digital applications, ensuring legibility and clarity.',
    color_intro: 'The palette grounds the brand in earth and sky: terracotta for warmth and craft, deep indigo for depth and trust, on a disciplined black and white base.',
    combinations: 'The consistent use of color is vital to effective brand recognition. Our brand should always be represented in one of the approved combinations on this page.',
    typeface_intro: 'This versatile and free-for-commercial-use font lends a contemporary edge to the brand’s visual communication, ensuring consistency and legibility across various platforms and materials.',
    closing: 'Build with intention. Represent the brand with care.',
  },
};

// Which template(s) to render: pass names as argv, default all.
const wanted = process.argv.slice(2).length ? process.argv.slice(2) : ['editorial', 'corporate', 'urban', 'contemporary'];

const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
for (const tpl of wanted) {
  const html = tpl === 'editorial' ? renderBrandBookHTML(doc as any) : renderAkriviHTML(doc as any, tpl as any);
  const dir = `/tmp/bb-preview/${tpl}`;
  mkdirSync(dir, { recursive: true });
  writeFileSync(`${dir}/book.html`, html);

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 900 });
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 45_000 });
  await page.evaluate(() => (document as any).fonts.ready);
  await page.pdf({ path: `${dir}/book.pdf`, printBackground: true, preferCSSPageSize: true });

  const count = await page.evaluate(() => document.querySelectorAll('.page').length);
  for (let i = 0; i < count; i++) {
    const el = (await page.$$('.page'))[i];
    await el.screenshot({ path: `${dir}/page-${String(i + 1).padStart(2, '0')}.png` });
  }
  await page.close();
  console.log(`${tpl}: ${count} pages → ${dir}`);
}
await browser.close();
