CREATE TABLE "telegram_login_challenges" (
  id UUID PRIMARY KEY DEFAULT uuidv7(), nonce_hash BYTEA NOT NULL UNIQUE,
  browser_hash BYTEA NOT NULL, intent VARCHAR(8) NOT NULL, status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  target_user_id UUID, session_family_id UUID, telegram_subject VARCHAR(24), telegram_username VARCHAR(32),
  approved_user_version INTEGER, code CHAR(6) NOT NULL, locale VARCHAR(2) NOT NULL,
  expires_at TIMESTAMPTZ(6) NOT NULL, consumed_at TIMESTAMPTZ(6), created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT telegram_challenge_intent_check CHECK (intent IN ('LOGIN','LINK')),
  CONSTRAINT telegram_challenge_status_check CHECK (status IN ('PENDING','BOT_SEEN','APPROVED','DENIED','EXPIRED','CONSUMED')),
  CONSTRAINT telegram_challenge_hash_check CHECK (octet_length(nonce_hash)=32 AND octet_length(browser_hash)=32),
  CONSTRAINT telegram_challenge_locale_check CHECK (locale IN ('ru','en')),
  CONSTRAINT telegram_challenge_link_check CHECK (intent <> 'LINK' OR (target_user_id IS NOT NULL AND session_family_id IS NOT NULL))
);
CREATE INDEX telegram_challenge_expiry_idx ON telegram_login_challenges(expires_at);
CREATE TABLE "telegram_webhook_receipts" (
  id UUID PRIMARY KEY DEFAULT uuidv7(), bot_id VARCHAR(24) NOT NULL, update_id BIGINT NOT NULL,
  created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), UNIQUE(bot_id,update_id)
);
CREATE TABLE "telegram_bot_outbox" (
  id UUID PRIMARY KEY DEFAULT uuidv7(), chat_id VARCHAR(24) NOT NULL, kind VARCHAR(32) NOT NULL,
  challenge_id UUID, locale VARCHAR(2) NOT NULL DEFAULT 'ru', status VARCHAR(16) NOT NULL DEFAULT 'PENDING',
  attempts INTEGER NOT NULL DEFAULT 0, available_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(), created_at TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT telegram_outbox_kind_check CHECK (kind IN ('LOGIN_CONFIRM','LOGIN_APPROVED','LOGIN_DENIED','HELP')),
  CONSTRAINT telegram_outbox_status_check CHECK (status IN ('PENDING','SENT','FAILED')),
  CONSTRAINT telegram_outbox_attempt_check CHECK (attempts BETWEEN 0 AND 5)
);
CREATE INDEX telegram_outbox_pending_idx ON telegram_bot_outbox(status,available_at);
