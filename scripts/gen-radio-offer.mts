// Generate the radio + 2 sites proposal as THREE separate offers inside one PDF.
// No payment installments. Run: npx tsx scripts/gen-radio-offer.mts
import puppeteer from 'puppeteer';
import { execFileSync } from 'node:child_process';
import { renderOfferHTML, type Offer } from '../src/lib/offer-template.ts';

const DATE = '24 iunie 2026';
const COMMON_NOTES = [
  'Termen de livrare: 14 zile.',
  'Dacă pornim cu toate cele trei proiecte deodată, lucrăm în paralel.',
  'Hosting inclus gratuit pe viață, fără cost anual recurent (în mod normal între 50 și 100 EUR pe an).',
];

// Compact notes so each single-page website offer fits on one A4 page.
const SITE_NOTES = [
  'Termen de livrare: 7 zile (în paralel dacă pornim cu toate trei deodată).',
  'Hosting inclus gratuit pe viață, fără cost anual recurent.',
];

const radio: Offer = {
  client: 'Post de Radio',
  title: 'Oferta 1 · Platformă radio',
  date: DATE,
  intro:
    'O platformă de radio online completă, gândită pentru ascultare live, conținut și interacțiune în timp real. Design pe măsură, texte scrise de noi și hosting inclus gratuit.',
  services: [
    {
      title: 'Experiența live',
      subtitle: 'Primul lucru pe care îl vede ascultătorul',
      items: [
        'Hero cu player live mare, vizibil imediat, buton Play/Pause și indicator LIVE.',
        'Numele postului, slogan și imagine sau video de fundal relevant.',
        'Secțiunea „Acum se difuzează": emisiunea curentă, moderatorul și piesa în redare (dacă există integrare).',
        'Afișarea automată a emisiunii care urmează în grilă.',
      ],
    },
    {
      title: 'Conținut și program',
      subtitle: 'Tot ce ține postul viu între difuzări',
      items: [
        'Program Radio: grilă zilnică și săptămânală, pagini individuale pentru fiecare emisiune.',
        'Știri și noutăți: articole actualizate, comunicate, evenimente promovate.',
        'Podcast și emisiuni înregistrate: replay-uri, podcast-uri audio, categorii și căutare.',
        'Prezentatori: fotografii profesionale, biografii scurte, linkuri social media.',
        'Galerie media: fotografii de la evenimente, videoclipuri, behind the scenes.',
      ],
    },
    {
      title: 'Interacțiune și ascultare',
      subtitle: 'Apropie ascultătorul de post',
      items: [
        'Cereri muzicale: formular dedicat, dedicații și mesaje pentru emisie.',
        'Aplicații și ascultare: linkuri App Store și Google Play, Smart Speaker, Android Auto și Apple CarPlay.',
        'Social feed integrat: Instagram, Facebook și highlights TikTok.',
        'Contact: telefon studio, WhatsApp, email și formular de contact.',
        'Publicitate: pachete media, audiență și statistici, formular pentru parteneriate.',
      ],
    },
    {
      title: 'Funcții premium care fac diferența',
      subtitle: 'Stratul care transformă un site într-o comunitate',
      items: [
        'Chat live cu ascultătorii și votare piese în timp real.',
        'Topuri săptămânale și concursuri interactive.',
        'Notificări push pentru emisiuni și evenimente.',
        'Cont de utilizator cu piese favorite salvate.',
        'Integrare AI DJ pentru recomandări personalizate.',
      ],
    },
  ],
  pricing: [
    { label: 'Platformă Radio', note: 'Player live, program, podcast, premium, AI DJ', amount: 2500, currency: 'EUR' },
  ],
  installments: [],
  notes: COMMON_NOTES,
};

const site1: Offer = {
  client: 'Post de Radio',
  title: 'Oferta 2 · Website de prezentare',
  date: DATE,
  intro:
    'Un website de prezentare complet, cu design pe măsură și texte scrise de noi.',
  services: [
    {
      title: 'Website de prezentare',
      subtitle: 'Design award-grade, texte incluse',
      items: [
        'Website de prezentare complet, design adaptat brandului.',
        'Structură pe măsura nevoilor: prezentare, servicii, galerie, contact.',
        'Optimizat pentru mobil și pentru viteză, texte gata de publicare.',
      ],
    },
  ],
  pricing: [
    { label: 'Website de prezentare', note: 'Design pe măsură + texte', amount: 1200, currency: 'EUR' },
  ],
  installments: [],
  notes: SITE_NOTES,
};

const site2: Offer = {
  ...site1,
  title: 'Oferta 3 · Al doilea website de prezentare',
  intro:
    'Al doilea website de prezentare, cu identitate și structură proprii. Aceeași calitate, design distinct.',
  services: [
    {
      title: 'Website de prezentare',
      subtitle: 'Identitate proprie, texte incluse',
      items: [
        'Al doilea website de prezentare, design și structură distincte.',
        'Pe măsura celui de-al doilea brand sau proiect.',
        'Optimizat pentru mobil și pentru viteză, texte gata de publicare.',
      ],
    },
  ],
};

// Fix: the eyebrow uses -webkit-background-clip:text with a gradient, which
// Chromium's headless PDF path fails to clip on wrapped/long titles, painting a
// solid block over the text. Render it as a solid brand color instead.
const FIX_EYEBROW = `
  .eyebrow{background:none !important;-webkit-text-fill-color:#b07cff !important;color:#b07cff !important}`;

// Tighten vertical rhythm so a short offer (a single website) closes its footer
// on one A4 sheet. Radio is content-rich and is meant to span two pages.
const TIGHTEN = `
  .hero{margin-bottom:24px}
  .hero h1{font-size:40px}
  .hero .intro{margin-top:12px}
  .section-label{margin:0 0 16px !important}
  .svc{padding:14px 0}
  .svc-list{margin-top:10px}
  .price-total{margin-top:12px}
  .notes{margin-top:20px}
  .foot{margin-top:20px}`;

const offers: { offer: Offer; tighten: boolean }[] = [
  { offer: radio, tighten: false },
  { offer: site1, tighten: true },
  { offer: site2, tighten: true },
];
const SCRATCH = '/private/tmp/claude-501/-Users-alexandrucojanu/6ec335fc-4dbf-48c5-9d7f-d8d45d2e21de/scratchpad';
const browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox', '--disable-dev-shm-usage'] });
const parts: string[] = [];
for (let i = 0; i < offers.length; i++) {
  const { offer, tighten } = offers[i];
  const overrides = FIX_EYEBROW + (tighten ? TIGHTEN : '');
  const html = renderOfferHTML(offer).replace('</style>', overrides + '\n</style>');
  const page = await browser.newPage();
  await page.setContent(html, { waitUntil: 'networkidle0', timeout: 30_000 });
  const p = `${SCRATCH}/offer-part-${i}.pdf`;
  await page.pdf({ path: p, format: 'A4', printBackground: true, preferCSSPageSize: true });
  await page.close();
  parts.push(p);
}
await browser.close();

const out = '/Users/alexandrucojanu/Desktop/Oferta-Platforma-Radio.pdf';
execFileSync('pdfunite', [...parts, out]);
console.log('Wrote ' + out);
