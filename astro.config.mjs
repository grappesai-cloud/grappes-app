import { defineConfig } from 'astro/config';
import node from '@astrojs/node';
import react from '@astrojs/react';
import sentry from '@sentry/astro';
import tailwindcss from '@tailwindcss/vite';

// Standalone Node server (Coolify/Hetzner). Chromium is NOT bundled — we use
// @sparticuz/chromium-min, which fetches the headless binary at runtime
// (see src/lib/browser.ts).

export default defineConfig({
  output: 'server',
  adapter: node({ mode: 'standalone' }),
  security: { checkOrigin: false }, // CSRF handled via auth middleware

  server: {
    host: '0.0.0.0',
    port: 4321,
  },

  vite: {
    plugins: [tailwindcss()],
    optimizeDeps: {
      include: ['@supabase/supabase-js'],
    },
    build: {
      rollupOptions: {
        external: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium-min', 'sharp'],
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
    // Sentry SDK options live in sentry.client.config.js + sentry.server.config.js
    // (inline integration options are deprecated in @sentry/astro 10+)
    sentry(),
  ],
});