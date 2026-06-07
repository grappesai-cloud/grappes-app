import { defineConfig } from 'astro/config';
import vercel from '@astrojs/vercel';
import react from '@astrojs/react';
import sentry from '@sentry/astro';
import tailwindcss from '@tailwindcss/vite';
import { existsSync } from 'node:fs';

// ffmpeg + ffprobe binaries are loaded by their installer packages via a
// computed `require(\`@x-installer/${platform}-${arch}/...\`)` call.
// @vercel/nft can't trace dynamic requires, so we explicitly include the
// linux-x64 binaries (the ones Vercel serverless functions run on).
// Only include paths that exist on the build machine — on a local macOS
// build these don't exist (only darwin-arm64 does), but Vercel installs
// linux-x64 via optionalDependencies when running on Linux.
const ffBinaries = [
  './node_modules/@ffmpeg-installer/linux-x64/ffmpeg',
  './node_modules/@ffmpeg-installer/linux-x64/package.json',
  './node_modules/@ffprobe-installer/linux-x64/ffprobe',
  './node_modules/@ffprobe-installer/linux-x64/package.json',
].filter((p) => existsSync(p));

// @sparticuz/chromium ships headless Chromium as brotli archives that
// executablePath() unpacks at runtime. Ensure the tracer bundles them.
const chromiumBinaries = [
  './node_modules/@sparticuz/chromium/bin/chromium.br',
  './node_modules/@sparticuz/chromium/bin/al2.tar.br',
  './node_modules/@sparticuz/chromium/bin/al2023.tar.br',
  './node_modules/@sparticuz/chromium/bin/fonts.tar.br',
  './node_modules/@sparticuz/chromium/bin/swiftshader.tar.br',
].filter((p) => existsSync(p));

export default defineConfig({
  output: 'server',
  adapter: vercel({
    maxDuration: 800,
    includeFiles: [...ffBinaries, ...chromiumBinaries],
  }),
  security: { checkOrigin: false }, // CSRF handled via auth middleware — Astro's checkOrigin breaks Vercel preview URLs

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
        external: ['puppeteer', 'puppeteer-core', '@sparticuz/chromium', 'sharp'],
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