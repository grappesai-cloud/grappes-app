// ── AI color palette suggestion ───────────────────────────────────────────────
// Takes a user description and returns 3 color palette options with hex codes.

import type { APIRoute } from 'astro';
import { db } from '../../../../lib/db';
import { createMessage, HAIKU_MODEL, INPUT_COST_PER_TOKEN, OUTPUT_COST_PER_TOKEN } from '../../../../lib/anthropic';
import { checkRateLimit } from '../../../../lib/rate-limit';
import { json } from '../../../../lib/api-utils';


export const POST: APIRoute = async ({ params, request, locals }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  if (!checkRateLimit(`suggest-colors:${user.id}`, 10, 3_600_000)) {
    return json({ error: 'Too many color suggestions. Please wait.' }, 429);
  }

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  let body: any;
  try { body = await request.json(); } catch { return json({ error: 'Invalid JSON' }, 400); }
  const { prompt, industry, style } = body;
  if (!prompt?.trim()) return json({ error: 'prompt required' }, 400);

  const systemPrompt = `You are a professional UI/UX color consultant. Return exactly 3 color palette options as JSON.

Each palette must have:
- name: short evocative name (2-3 words)
- description: 1 sentence explaining the mood
- primary: hex color (main brand color)
- secondary: hex color (backgrounds, cards)
- accent: hex color (CTAs, highlights)

Rules:
- Primary should work for buttons and headings
- Secondary should work as a light background or card background
- Accent should pop and contrast well
- All hex values must be valid 6-digit hex codes starting with #
- Consider the industry and style when picking colors
- Make each palette distinctly different in mood

Respond ONLY with valid JSON like:
{"palettes":[{"name":"...","description":"...","primary":"#...","secondary":"#...","accent":"#..."},...]}`

  const userMessage = `Industry: ${industry || 'general'}
Style preference: ${style || 'modern'}
User description: ${prompt.trim()}

Give me 3 color palettes.`;

  try {
    const response = await createMessage({
      model: HAIKU_MODEL,
      max_tokens: 600,
      system: systemPrompt,
      messages: [{ role: 'user', content: userMessage }],
    });

    const raw = response.content[0]?.type === 'text' ? response.content[0].text : '';
    // Strip any markdown code fences
    const cleaned = raw.replace(/```json\n?/gi, '').replace(/```\n?/g, '').trim();

    let parsed: any;
    try {
      parsed = JSON.parse(cleaned);
    } catch {
      return json({ error: 'AI returned invalid response' }, 500);
    }

    // Track cost
    const inTok = response.usage?.input_tokens ?? 0;
    const outTok = response.usage?.output_tokens ?? 0;
    await db.costs.create({
      project_id: params.projectId!, type: 'onboarding', model: HAIKU_MODEL,
      input_tokens: inTok, output_tokens: outTok,
      cost_usd: inTok * INPUT_COST_PER_TOKEN + outTok * OUTPUT_COST_PER_TOKEN,
    });

    return json({ palettes: parsed.palettes ?? [] });
  } catch (e: any) {
    console.error('[suggest-colors]', e);
    return json({ error: e.message || 'AI error' }, 500);
  }
};
