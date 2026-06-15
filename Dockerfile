# Astro SSR (multi-product platform) on Node, for Coolify/Hetzner.
# Build with DEPLOY_TARGET=node so astro.config picks @astrojs/node.
FROM node:22-slim AS base
WORKDIR /app

# ── deps ──
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci

# ── build ──
FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV DEPLOY_TARGET=node
RUN npm run build

# ── runtime ──
FROM node:22-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
ENV HOST=0.0.0.0
ENV PORT=4321

# ffmpeg (reel-lab renders) + chromium (puppeteer/PDF) + fonts + sharp libs
RUN apt-get update && apt-get install -y --no-install-recommends \
      ffmpeg chromium ca-certificates fonts-liberation \
    && rm -rf /var/lib/apt/lists/*
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

COPY --from=build /app/dist ./dist
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/package.json ./package.json

EXPOSE 4321
CMD ["node", "./dist/server/entry.mjs"]
