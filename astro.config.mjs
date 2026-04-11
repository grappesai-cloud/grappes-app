import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import sentry from '@sentry/astro';

export default defineConfig({
  output: 'server',
  adapter: vercel(),
  security: { checkOrigin: false }, // CSRF handled via auth middleware — Astro's checkOrigin breaks Vercel preview URLs

  server: {
    host: '0.0.0.0',
    port: 4321,
  },

  vite: {
    build: {
      rollupOptions: {
        external: ['puppeteer', 'sharp'],
      },
    },
    resolve: {
      alias: {
        '@lib': '/src/lib',
        '@components': '/src/components',
        '@layouts': '/src/layouts',
      },
    },
  },

  integrations: [
    react(),
    sentry({
      dsn: process.env.SENTRY_DSN || '',
      environment: process.env.NODE_ENV || 'production',
      tracesSampleRate: 0.1, // 10% of requests for performance monitoring
      // Only enable if DSN is set — graceful no-op otherwise
      enabled: !!process.env.SENTRY_DSN,
    }),
  ],
});