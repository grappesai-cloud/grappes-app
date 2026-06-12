import type { APIRoute } from 'astro';
import { createMessage, HAIKU_MODEL, INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN } from '../../../lib/anthropic';
import { checkRateLimit } from '../../../lib/rate-limit';
import { json } from '../../../lib/api-utils';

// Offer Lab AI intake: a short Romanian conversation that turns a free
// description into a structured Offer the form can be populated with. The model
// asks 1-2 clarifying questions only if essential details are missing, then
// produces the offer. Response format (parsed server-side):
//   ---REPLY---
//   <short message in Romanian>
//   ---OFFER---
//   <JSON Offer, or {} if not enough data yet>
//   ---END---
const SYSTEM = `Ești un asistent care ajută un freelancer/agenție să construiască o ofertă pentru un client, în limba română. Pe baza descrierii userului, generezi o ofertă concretă și profesionistă (nu placeholder). Pui CEL MULT 1-2 întrebări scurte doar dacă lipsesc detalii esențiale (cine e clientul, ce servicii, ce preț). Dacă userul îți dă destul, construiești direct oferta fără să mai întrebi.

Răspunde MEREU EXACT în acest format:
---REPLY---
{mesaj scurt și prietenos în română, max 2 propoziții}
---OFFER---
{un obiect JSON cu structura de mai jos, SAU {} dacă încă nu ai date suficiente}
---END---

Structura Offer (omite câmpurile pe care nu le ai):
{
  "client": "string",
  "title": "string",
  "intro": "string (1 paragraf de context)",
  "services": [{ "title": "string", "subtitle": "string (opțional)", "items": ["punct", "punct"] }],
  "pricing": [{ "label": "string", "note": "string (opțional)", "amount": number, "currency": "EUR" }],
  "installments": [{ "label": "string", "detail": "string (opțional)", "amount": number, "currency": "EUR" }],
  "notes": ["mențiune"]
}

Reguli: sumele sunt numere (fără simbol). Moneda implicită EUR. Scrie copy specific brandului/serviciilor descrise. Nu inventa prețuri dacă userul nu le-a dat decât dacă îți cere explicit o estimare. Nu folosi liniuțe lungi (—). Output DOAR în formatul de mai sus.`;

interface ChatMsg { role: 'user' | 'assistant'; content: string }

export const POST: APIRoute = async ({ request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);
  if (!checkRateLimit(`offers-chat:${user.id}`, 40, 3_600_000)) {
    return json({ error: 'Prea multe mesaje. Așteaptă puțin.' }, 429);
  }

  try {
    const body = await request.json().catch(() => ({}));
    const history = (Array.isArray(body.messages) ? body.messages : []) as ChatMsg[];
    const messages = history
      .filter((m) => (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-20)
      .map((m) => ({ role: m.role, content: m.content }));
    if (messages.length === 0 || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'No user message' }, 400);
    }

    const res = await createMessage({ model: HAIKU_MODEL, max_tokens: 2000, system: SYSTEM, messages });
    const raw = res.content[0]?.type === 'text' ? res.content[0].text : '';

    // Parse ---REPLY--- / ---OFFER--- / ---END---
    let reply = raw.trim();
    let offer: Record<string, any> | null = null;
    const offIdx = raw.indexOf('---OFFER---');
    if (offIdx !== -1) {
      reply = raw.slice(0, offIdx).replace(/^---REPLY---\s*/i, '').trim();
      let offBlock = raw.slice(offIdx + '---OFFER---'.length);
      const endIdx = offBlock.indexOf('---END---');
      if (endIdx !== -1) offBlock = offBlock.slice(0, endIdx);
      offBlock = offBlock.replace(/```(?:json)?/gi, '').trim();
      try {
        const parsed = JSON.parse(offBlock);
        if (parsed && typeof parsed === 'object' && Object.keys(parsed).length > 0) offer = parsed;
      } catch { /* not ready / malformed — leave offer null */ }
    } else {
      reply = raw.replace(/^---REPLY---\s*/i, '').replace(/---END---[\s\S]*/, '').trim();
    }
    const done = !!(offer && ((offer.services?.length ?? 0) > 0 || (offer.pricing?.length ?? 0) > 0));

    const inT = res.usage?.input_tokens ?? 0;
    const outT = res.usage?.output_tokens ?? 0;
    // Best-effort cost log (non-fatal); offers have no project_id, so skip the costs table.
    void (inT * INPUT_COST_PER_TOKEN + outT * OUTPUT_COST_PER_TOKEN);

    return json({ reply: reply || 'Spune-mi mai multe despre ofertă.', offer, done });
  } catch (e: any) {
    console.error('[POST /api/offers/chat]', e);
    const overloaded = e?.status === 529 || e?.status === 429;
    return json({ error: overloaded ? 'AI ocupat, încearcă din nou în câteva secunde.' : 'Eroare internă' }, overloaded ? 503 : 500);
  }
};
