ALTER TABLE "technical_crawls"
  DROP CONSTRAINT "technical_crawls_backoff_check",
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
        'LATENCY_SPIKE',
        'SITE_PAUSED'
      )
      AND "backoff_until" IS NOT NULL
    )
  );
