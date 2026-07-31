ALTER TABLE "technical_crawls"
  ADD COLUMN "backoff_code" VARCHAR(64),
  ADD COLUMN "backoff_until" TIMESTAMPTZ(6),
  ADD CONSTRAINT "technical_crawls_backoff_check" CHECK (
    (
      "backoff_code" IS NULL
      AND "backoff_until" IS NULL
    )
    OR (
      "backoff_code" IN (
        'HOST_RATE_LIMIT',
        'HOST_UNAVAILABLE',
        'HOST_NETWORK_ERROR',
        'LATENCY_SPIKE'
      )
      AND "backoff_until" IS NOT NULL
    )
  );

CREATE INDEX "technical_crawls_status_backoff_idx"
  ON "technical_crawls"("status", "backoff_until", "created_at");

CREATE TABLE "crawl_host_states" (
  "host" VARCHAR(253) NOT NULL,
  "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
  "backoff_until" TIMESTAMPTZ(6),
  "last_failure_code" VARCHAR(64),
  "last_status_code" INTEGER,
  "last_failure_at" TIMESTAMPTZ(6),
  "last_success_at" TIMESTAMPTZ(6),
  "latency_ewma_ms" INTEGER,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crawl_host_states_pkey" PRIMARY KEY ("host"),
  CONSTRAINT "crawl_host_states_host_check" CHECK (
    length("host") BETWEEN 1 AND 253
    AND "host" = lower("host")
    AND "host" !~ '[/@]'
  ),
  CONSTRAINT "crawl_host_states_values_check" CHECK (
    "consecutive_failures" BETWEEN 0 AND 30
    AND (
      "last_failure_code" IS NULL
      OR "last_failure_code" ~ '^[A-Z][A-Z0-9_]{0,63}$'
    )
    AND (
      "last_status_code" IS NULL
      OR "last_status_code" BETWEEN 100 AND 599
    )
    AND (
      "latency_ewma_ms" IS NULL
      OR "latency_ewma_ms" BETWEEN 0 AND 3600000
    )
    AND (
      "backoff_until" IS NULL
      OR "last_failure_at" IS NOT NULL
    )
  )
);

CREATE INDEX "crawl_host_states_backoff_idx"
  ON "crawl_host_states"("backoff_until");
