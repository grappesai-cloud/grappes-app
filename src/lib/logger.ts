// ── Structured logger ────────────────────────────────────────────────────────
// Drop-in replacement for console.log/warn/error with JSON output.
// On Vercel, JSON logs are parsed and indexed automatically.
// Falls back to console in dev for readability.

import pino from 'pino';

const isDev = process.env.NODE_ENV === 'development' || import.meta.env.DEV;

export const logger = pino({
  level: isDev ? 'debug' : 'info',
  transport: isDev
    ? { target: 'pino/file', options: { destination: 1 } } // stdout
    : undefined,
  // In production, pino outputs JSON to stdout — Vercel indexes it
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Convenience child loggers for major subsystems
export const log = {
  onboarding: logger.child({ module: 'onboarding' }),
  generation: logger.child({ module: 'generation' }),
  deploy:     logger.child({ module: 'deploy' }),
  billing:    logger.child({ module: 'billing' }),
  auth:       logger.child({ module: 'auth' }),
  assets:     logger.child({ module: 'assets' }),
  webhook:    logger.child({ module: 'webhook' }),
  cron:       logger.child({ module: 'cron' }),
  api:        logger.child({ module: 'api' }),
};
