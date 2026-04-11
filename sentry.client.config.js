import * as Sentry from '@sentry/astro';

Sentry.init({
  dsn: import.meta.env.PUBLIC_SENTRY_DSN || '',
  environment: import.meta.env.MODE || 'production',
  tracesSampleRate: 0.1,
  enabled: !!import.meta.env.PUBLIC_SENTRY_DSN,
  // Don't flood on expected client errors
  beforeSend(event) {
    const status = event.contexts?.response?.status_code;
    if (status && [401, 403, 404, 429].includes(status)) return null;
    return event;
  },
});
