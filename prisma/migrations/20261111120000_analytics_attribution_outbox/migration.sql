-- Deploy before the web/API changes. No existing purchases are replayed.
CREATE TABLE account_attribution (
  user_id text PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  first_touch jsonb,
  last_touch jsonb,
  analytics_context jsonb NOT NULL DEFAULT '{}',
  context_updated_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE conversion_analytics_outbox (
  event_id text PRIMARY KEY,
  user_id text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  event_name text NOT NULL,
  context jsonb NOT NULL,
  params jsonb NOT NULL,
  attribution jsonb,
  include_session boolean NOT NULL DEFAULT false,
  occurred_at timestamptz NOT NULL,
  delivery_status text NOT NULL,
  attempts integer NOT NULL DEFAULT 0,
  available_at timestamptz NOT NULL DEFAULT now(),
  lease_until timestamptz,
  lease_token text,
  last_error text,
  delivered_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversion_analytics_pending_idx ON conversion_analytics_outbox(available_at)
  WHERE delivery_status = 'PENDING';
