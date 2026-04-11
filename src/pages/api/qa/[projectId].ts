import type { APIRoute } from 'astro';
import { db } from '../../../lib/db';
import { runQA, formatQAReport } from '../../../lib/qa';
import { runVisualQA, formatVisualQAReport } from '../../../lib/visual-qa';
import { json } from '../../../lib/api-utils';


// GET — returns HTML structure QA + (if available) visual QA results
// Query params:
//   ?format=text         → human-readable plain text
//   ?visual=run&url=...  → trigger fresh visual QA against a URL (slow, ~30s)
export const GET: APIRoute = async ({ params, locals, url }) => {
  const user = locals.user;
  if (!user) return json({ error: 'Unauthorized' }, 401);

  const project = await db.projects.findById(params.projectId!);
  if (!project || project.user_id !== user.id) return json({ error: 'Not found' }, 404);

  const latest = await db.generatedFiles.findLatest(params.projectId!);
  if (!latest) return json({ error: 'No generated files found. Run generation first.' }, 404);

  // ── Trigger fresh visual QA on demand (?visual=run&url=https://...) ──────
  if (url.searchParams.get('visual') === 'run') {
    const targetUrl = url.searchParams.get('url') ?? project.preview_url;
    if (!targetUrl) return json({ error: 'Provide ?url= or deploy the project first.' }, 400);
    const visualReport = await runVisualQA(params.projectId!, targetUrl);
    if (url.searchParams.get('format') === 'text') {
      return new Response(formatVisualQAReport(visualReport), {
        headers: { 'Content-Type': 'text/plain' },
      });
    }
    return json({ projectId: params.projectId, version: latest.version, visual: visualReport });
  }

  // ── HTML structure QA (always available, no browser needed) ─────────────
  const htmlQA = runQA(latest.files, params.projectId!);

  // ── Stored visual QA results (set automatically after each deployment) ───
  const storedVisualQA = latest.files['__visual-qa.json']
    ? JSON.parse(latest.files['__visual-qa.json'])
    : null;

  if (url.searchParams.get('format') === 'text') {
    return new Response(formatQAReport(htmlQA), {
      headers: { 'Content-Type': 'text/plain' },
    });
  }

  return json({
    projectId:  params.projectId,
    version:    latest.version,
    html:       htmlQA,
    visual:     storedVisualQA ?? { note: 'Not yet run — deploy the project to trigger visual QA automatically.' },
    isReady:    htmlQA.isReady && (storedVisualQA?.passed ?? true),
  });
};
