import type { APIRoute } from 'astro';

const SITE = 'https://grappes.dev';

// Public routes that should appear in the sitemap. Dashboard/admin/api routes
// are authenticated and intentionally excluded (and blocked via robots.txt).
const ROUTES = [
  { path: '/',         changefreq: 'weekly',  priority: 1.0 },
  { path: '/sign-up',  changefreq: 'monthly', priority: 0.9 },
  { path: '/sign-in',  changefreq: 'monthly', priority: 0.7 },
  { path: '/terms',    changefreq: 'yearly',  priority: 0.4 },
  { path: '/privacy',  changefreq: 'yearly',  priority: 0.4 },
];

export const GET: APIRoute = () => {
  const lastmod = new Date().toISOString().slice(0, 10);
  const urls = ROUTES.map(
    (r) => `  <url>
    <loc>${SITE}${r.path}</loc>
    <lastmod>${lastmod}</lastmod>
    <changefreq>${r.changefreq}</changefreq>
    <priority>${r.priority}</priority>
  </url>`
  ).join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;

  return new Response(xml, {
    status: 200,
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};
