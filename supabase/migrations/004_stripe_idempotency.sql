-- Stripe webhook idempotency table.
-- Every processed event ID is recorded here. Before handling an event we
-- attempt to INSERT the event ID; if the unique constraint fires we know
-- Stripe is retrying an already-handled event and we can skip it safely.

CREATE TABLE IF NOT EXISTS stripe_processed_events (
  event_id    text PRIMARY KEY,
  event_type  text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now()
);

-- Optional: auto-purge events older than 30 days to keep the table small
-- (handled via a Supabase scheduled job or pg_cron if available)
