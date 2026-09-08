CREATE TABLE provider_balance_notifications (
  account_id UUID PRIMARY KEY,
  provider VARCHAR(16) NOT NULL CHECK (provider IN ('XMLSTOCK', 'ARSENKIN')),
  slot INTEGER NOT NULL CHECK (slot BETWEEN 1 AND 64),
  low BOOLEAN NOT NULL,
  pending BOOLEAN NOT NULL,
  generation INTEGER NOT NULL DEFAULT 0 CHECK (generation >= 0),
  balance_minor BIGINT NOT NULL CHECK (balance_minor >= 0),
  observed_at TIMESTAMPTZ(6) NOT NULL,
  next_attempt_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  lease_token UUID,
  lease_expires_at TIMESTAMPTZ(6),
  updated_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CHECK (NOT pending OR low AND generation > 0),
  CHECK ((lease_token IS NULL AND lease_expires_at IS NULL) OR (lease_token IS NOT NULL AND lease_expires_at IS NOT NULL))
);
CREATE INDEX provider_balance_notifications_pending_idx ON provider_balance_notifications(pending, next_attempt_at);
