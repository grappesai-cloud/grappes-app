import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: process.env.SENTRY_DSN || '',
  environment: process.env.NODE_ENV || 'production',
  tracesSampleRate: 0.1,
  enabled: !!process.env.SENTRY_DSN,
  // Filter out expected errors
  beforeSend(event) {
    // Don't report 401/403/404 as errors
    const status = event.contexts?.response?.status_code;
    if (status && [401, 403, 404, 429].includes(status)) return null;
    return event;
  },
});
