// ─── Offer template ───────────────────────────────────────────────────────────
// Renders a client offer / proposal as a standalone, print-ready HTML document
// in the Grappes brand: dark, bold, editorial, magenta→purple→blue gradient,
// big light typography (matches grappes.dev). A4.
// The SAME function powers the live preview (iframe) and the server PDF
// (Puppeteer page.pdf()), so what the user sees is exactly what downloads.
//
// House rule: no em-dashes in user-facing copy. Use commas / periods / middot.

import { GRAPPES_LOGO_DATA_URI } from './grappes-logo';

export interface OfferService {
  title: string;
  subtitle?: string;
  items: string[];
}

export interface OfferLineItem {
  label: string;
  note?: string;
  amount: number;
  currency?: string;
}

export interface OfferInstallment {
  label: string;
  detail?: string;
  amount: number;
  currency?: string;
}

export interface Offer {
  client: string;
  title?: string;
  intro?: string;
  date?: string;
  validUntil?: string;
  services: OfferService[];
  pricing: OfferLineItem[];
  installments: OfferInstallment[];
  notes?: string[];
  contactName?: string;
  contactEmail?: string;
  contactSite?: string;
}

function esc(s: unknown): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function fmtAmount(amount: number, currency = 'EUR'): string {
  const n = Number(amount) || 0;
  const pretty = n.toLocaleString('ro-RO');
  const sym = currency === 'EUR' ? '€' : currency === 'RON' ? 'RON' : currency;
  return currency === 'EUR' ? `${sym}${pretty}` : `${pretty} ${sym}`;
}

export function offerTotal(pricing: OfferLineItem[]): { amount: number; currency: string } {
  const currency = pricing[0]?.currency || 'EUR';
  const amount = pricing.reduce((s, p) => s + (Number(p.amount) || 0), 0);
  return { amount, currency };
}

export function renderOfferHTML(offer: Offer): string {
  const {
    client,
    title = 'Ofertă de colaborare',
    intro,
    date,
    validUntil,
    services = [],
    pricing = [],
    installments = [],
    notes = [],
    contactName = 'Grappes',
    contactEmail = 'hello@grappes.dev',
    contactSite = 'grappes.dev',
  } = offer;

  const total = offerTotal(pricing);

  const servicesHTML = services
    .map(
      (svc, i) => `
      <section class="svc">
        <div class="svc-no">${String(i + 1).padStart(2, '0')}</div>
        <div class="svc-main">
          <h3 class="svc-title">${esc(svc.title)}</h3>
          ${svc.subtitle ? `<p class="svc-sub">${esc(svc.subtitle)}</p>` : ''}
          <ul class="svc-list">
            ${svc.items.map((it) => `<li>${esc(it)}</li>`).join('')}
          </ul>
        </div>
      </section>`,
    )
    .join('');

  const pricingHTML = pricing
    .map(
      (p) => `
      <div class="price-row">
        <div class="price-label">
          <span>${esc(p.label)}</span>
          ${p.note ? `<small>${esc(p.note)}</small>` : ''}
        </div>
        <div class="price-amount">${esc(fmtAmount(p.amount, p.currency))}</div>
      </div>`,
    )
    .join('');

  const installmentsHTML = installments
    .map(
      (t, i) => `
      <li class="step">
        <span class="step-dot">${i + 1}</span>
        <div class="step-body">
          <div class="step-top">
            <span class="step-label">${esc(t.label)}</span>
            <span class="step-amount">${esc(fmtAmount(t.amount, t.currency))}</span>
          </div>
          ${t.detail ? `<span class="step-detail">${esc(t.detail)}</span>` : ''}
        </div>
      </li>`,
    )
    .join('');

  const notesHTML = notes.length
    ? `<section class="notes">
        <h4>Mențiuni</h4>
        <ul>${notes.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>
       </section>`
    : '';

  return `<!doctype html>
<html lang="ro">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(title)} · ${esc(client)}</title>
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link href="https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&display=swap" rel="stylesheet" />
<style>
  :root {
    --bg: #0b0b0f;
    --ink: #ffffff;
    --muted: rgba(255,255,255,0.56);
    --dim: rgba(255,255,255,0.34);
    --line: rgba(255,255,255,0.10);
    --line-soft: rgba(255,255,255,0.06);
    --grad: linear-gradient(120deg, #d36bff 0%, #8b5cf6 48%, #3b6bf3 100%);
  }
  * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  html, body { margin: 0; padding: 0; }
  body {
    font-family: 'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif;
    color: var(--ink);
    background: #050507;
    font-size: 14px; line-height: 1.55;
    -webkit-font-smoothing: antialiased;
  }
  .page {
    width: 210mm; min-height: 297mm; margin: 0 auto;
    background: var(--bg); color: var(--ink);
    padding: 22mm 20mm 18mm; position: relative; overflow: hidden;
  }
  /* Ambient brand glow, like the site's gradient atmosphere */
  .page::before {
    content: ''; position: absolute; top: -120px; right: -120px;
    width: 480px; height: 480px; border-radius: 50%;
    background: radial-gradient(circle, rgba(139,92,246,0.30), transparent 62%);
    filter: blur(20px); pointer-events: none;
  }
  .page::after {
    content: ''; position: absolute; bottom: -160px; left: -140px;
    width: 460px; height: 460px; border-radius: 50%;
    background: radial-gradient(circle, rgba(59,107,243,0.22), transparent 62%);
    filter: blur(20px); pointer-events: none;
  }
  .page > * { position: relative; z-index: 1; }

  .grad-text {
    background: var(--grad);
    -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; color: transparent;
  }

  /* ── Header ─────────────────────────────────────────────────────────── */
  .head {
    display: flex; align-items: center; justify-content: space-between;
    padding-bottom: 22px; margin-bottom: 40px;
    border-bottom: 1px solid var(--line);
  }
  .brand { display: flex; align-items: center; gap: 11px; }
  .brand img { width: 34px; height: 34px; display: block; }
  .brand-name { font-size: 18px; font-weight: 600; letter-spacing: -0.03em; }
  .head-meta { text-align: right; font-size: 11px; color: var(--dim); line-height: 1.8; letter-spacing: 0.01em; }
  .head-meta b { color: var(--muted); font-weight: 600; }

  /* ── Hero ───────────────────────────────────────────────────────────── */
  .hero { margin-bottom: 52px; }
  .eyebrow {
    display: inline-block; font-size: 11px; font-weight: 700;
    letter-spacing: 0.18em; text-transform: uppercase; margin-bottom: 18px;
  }
  .hero h1 {
    margin: 0; font-size: 52px; font-weight: 300; letter-spacing: -0.04em; line-height: 0.98;
  }
  .hero h1 strong { font-weight: 600; }
  .hero .client {
    margin-top: 18px; font-size: 15px; color: var(--muted);
  }
  .hero .client b { color: var(--ink); font-weight: 600; font-size: 17px; letter-spacing: -0.01em; }
  .hero .intro {
    margin-top: 20px; max-width: 60ch; color: var(--muted); font-size: 14px; line-height: 1.7;
  }

  /* ── Section label ──────────────────────────────────────────────────── */
  .section-label {
    display: flex; align-items: center; gap: 14px;
    font-size: 11px; font-weight: 700; letter-spacing: 0.18em; text-transform: uppercase;
    color: var(--dim); margin: 0 0 26px;
  }
  .section-label::after { content: ''; flex: 1; height: 1px; background: var(--line-soft); }

  /* ── Services (editorial, no boxes) ─────────────────────────────────── */
  .svc {
    display: grid; grid-template-columns: 56px 1fr; gap: 8px 4px;
    padding: 22px 0; border-top: 1px solid var(--line-soft);
    break-inside: avoid;
  }
  .svc:first-of-type { border-top: none; padding-top: 4px; }
  .svc-no { font-size: 15px; font-weight: 700; line-height: 1.4;
    background: var(--grad); -webkit-background-clip: text; background-clip: text;
    -webkit-text-fill-color: transparent; }
  .svc-title { margin: 0; font-size: 23px; font-weight: 500; letter-spacing: -0.025em; }
  .svc-sub { margin: 5px 0 0; font-size: 13px; color: var(--muted); }
  .svc-list { margin: 16px 0 0; padding: 0; list-style: none;
    display: grid; grid-template-columns: 1fr 1fr; gap: 9px 26px; }
  .svc-list li {
    position: relative; padding-left: 20px; font-size: 13px; line-height: 1.5;
    color: rgba(255,255,255,0.82);
  }
  .svc-list li::before {
    content: ''; position: absolute; left: 0; top: 7px;
    width: 7px; height: 7px; border-radius: 50%; background: var(--grad);
  }

  /* ── Pricing ────────────────────────────────────────────────────────── */
  .pricing { margin-top: 6px; }
  .price-row {
    display: flex; align-items: center; justify-content: space-between;
    padding: 16px 0; border-bottom: 1px solid var(--line-soft);
  }
  .price-label { display: flex; flex-direction: column; gap: 3px; }
  .price-label span { font-size: 15px; font-weight: 600; }
  .price-label small { font-size: 11.5px; color: var(--dim); }
  .price-amount { font-size: 17px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
  .price-total {
    display: flex; align-items: center; justify-content: space-between;
    margin-top: 18px; padding: 20px 22px; border-radius: 16px;
    background: var(--grad); color: #0b0b0f;
  }
  .price-total .lbl { font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; opacity: 0.7; }
  .price-total .amt { font-size: 26px; font-weight: 700; letter-spacing: -0.02em; }

  /* ── Payment plan ───────────────────────────────────────────────────── */
  .plan { list-style: none; margin: 6px 0 0; padding: 0; position: relative; }
  .plan::before {
    content: ''; position: absolute; left: 13px; top: 14px; bottom: 14px; width: 2px;
    background: linear-gradient(#d36bff, #3b6bf3);
  }
  .step { display: flex; gap: 18px; padding: 10px 0; break-inside: avoid; }
  .step-dot {
    flex: none; position: relative; z-index: 1;
    width: 28px; height: 28px; border-radius: 50%;
    background: var(--bg); border: 2px solid transparent;
    background-image: linear-gradient(var(--bg), var(--bg)), var(--grad);
    background-origin: border-box; background-clip: padding-box, border-box;
    display: flex; align-items: center; justify-content: center;
    font-size: 12px; font-weight: 700; color: #fff;
  }
  .step-body { flex: 1; padding-top: 2px; }
  .step-top { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; }
  .step-label { font-size: 14.5px; font-weight: 600; }
  .step-amount { font-size: 14.5px; font-weight: 700; font-variant-numeric: tabular-nums; }
  .step-detail { display: block; margin-top: 3px; font-size: 12px; color: var(--muted); }

  /* ── Notes ──────────────────────────────────────────────────────────── */
  .notes { margin-top: 44px; break-inside: avoid; }
  .notes h4 { margin: 0 0 12px; font-size: 11px; font-weight: 700; letter-spacing: 0.16em; text-transform: uppercase; color: var(--dim); }
  .notes ul { margin: 0; padding: 0; list-style: none; }
  .notes li { position: relative; padding-left: 16px; font-size: 12px; color: var(--muted); margin-bottom: 7px; line-height: 1.55; }
  .notes li::before { content: ''; position: absolute; left: 0; top: 7px; width: 5px; height: 5px; border-radius: 50%; background: var(--dim); }

  /* ── Footer ─────────────────────────────────────────────────────────── */
  .foot {
    margin-top: 48px; padding-top: 18px; border-top: 1px solid var(--line);
    display: flex; align-items: center; justify-content: space-between;
    font-size: 11.5px; color: var(--dim);
  }
  .foot .l { display: flex; align-items: center; gap: 9px; }
  .foot img { width: 18px; height: 18px; }
  .foot b { color: var(--muted); font-weight: 600; }
  .foot a { color: #fff; text-decoration: none; }

  @page { size: A4; margin: 0; }
  @media print { body { background: var(--bg); } .page { margin: 0; } }
  @media screen {
    body { background: #050507; }
    .page { box-shadow: 0 30px 80px rgba(0,0,0,0.5); margin-top: 24px; margin-bottom: 24px; }
  }
</style>
</head>
<body>
  <div class="page">
    <header class="head">
      <div class="brand">
        <img src="${GRAPPES_LOGO_DATA_URI}" alt="Grappes" />
        <span class="brand-name">grappes</span>
      </div>
      <div class="head-meta">
        ${date ? `<div><b>Data</b> · ${esc(date)}</div>` : ''}
        ${validUntil ? `<div><b>Valabilă până</b> · ${esc(validUntil)}</div>` : ''}
      </div>
    </header>

    <div class="hero">
      <span class="eyebrow grad-text">${esc(title)}</span>
      <h1>Propunere de<br/><strong>colaborare.</strong></h1>
      <div class="client">Pregătită pentru <b>${esc(client)}</b></div>
      ${intro ? `<p class="intro">${esc(intro)}</p>` : ''}
    </div>

    <div class="section-label">Ce includem</div>
    ${servicesHTML}

    <div class="section-label" style="margin-top:48px">Investiție</div>
    <div class="pricing">
      ${pricingHTML}
      <div class="price-total">
        <span class="lbl">Total</span>
        <span class="amt">${esc(fmtAmount(total.amount, total.currency))}</span>
      </div>
    </div>

    ${
      installments.length
        ? `<div class="section-label" style="margin-top:48px">Plata în tranșe</div>
           <ul class="plan">${installmentsHTML}</ul>`
        : ''
    }

    ${notesHTML}

    <footer class="foot">
      <div class="l"><img src="${GRAPPES_LOGO_DATA_URI}" alt="" /><span><b>${esc(contactName)}</b> · ${esc(contactEmail)}</span></div>
      <div><a href="https://${esc(contactSite)}">${esc(contactSite)}</a></div>
    </footer>
  </div>
</body>
</html>`;
}

// Sample offer used to seed the builder and the test export.
export const SAMPLE_OFFER: Offer = {
  client: 'Adelina Delia Dragoș',
  title: 'Ofertă website + branding',
  date: '31 mai 2026',
  intro:
    'Construim o prezență online completă: un website award-grade cu plăți integrate, o identitate de brand coerentă și sprijin continuu pentru creșterea pe social media.',
  services: [
    {
      title: 'Website',
      subtitle: 'Landing page award-grade cu plăți integrate',
      items: [
        'Landing page de calitate award-grade, design pe măsură.',
        'Integrare Stripe pentru plăți online (comision 1,5% + 1 RON per tranzacție).',
        'Hosting pe viață inclus gratuit (în mod normal între 50 și 100 EUR pe an).',
        'Admin dashboard din care poți modifica singură fotografiile și textele.',
      ],
    },
    {
      title: 'Branding',
      subtitle: 'Identitate vizuală completă',
      items: [
        'Logo și sistem de identitate.',
        'Paletă de culori și fonturi.',
        'Brandbook cu regulile de aplicare.',
        'Reguli pentru postări și reels-uri.',
      ],
    },
    {
      title: 'Sprijin pe durata colaborării',
      subtitle: 'Inclus gratuit',
      items: [
        'Ajutor pentru promovarea pe social media, orientat pe creștere.',
        'Recomandări și setup pentru reclame.',
      ],
    },
  ],
  pricing: [
    { label: 'Branding', note: 'Logo, paletă, font, brandbook, reguli social', amount: 500, currency: 'EUR' },
    { label: 'Website', note: 'Landing page + Stripe + admin dashboard + hosting', amount: 1000, currency: 'EUR' },
  ],
  installments: [
    { label: 'Tranșa 1 · Branding', detail: 'La începutul colaborării, integral.', amount: 500, currency: 'EUR' },
    { label: 'Tranșa 2 · Start website', detail: '50% din valoarea website-ului, când începem.', amount: 500, currency: 'EUR' },
    { label: 'Tranșa 3 · Finalizare website', detail: 'Restul de 50%, la livrare.', amount: 500, currency: 'EUR' },
  ],
  notes: [
    'Comisionul Stripe de 1,5% + 1 RON per tranzacție este reținut de procesatorul de plăți, nu de noi.',
    'Hostingul pe viață este inclus în pachet, fără cost anual recurent.',
    'Sprijinul pentru social media este oferit gratuit pe durata colaborării.',
  ],
};
