ALTER TABLE "technical_crawls"
  DROP CONSTRAINT "technical_crawls_checkpoint_check";

ALTER TABLE "technical_crawls"
  ADD CONSTRAINT "technical_crawls_checkpoint_check" CHECK (
    "checkpoint" IS NULL OR (
      jsonb_typeof("checkpoint") = 'object' AND
      ("checkpoint"->>'version')::integer IN (1, 2) AND
      jsonb_typeof("checkpoint"->'pending') = 'array' AND
      jsonb_typeof("checkpoint"->'seen') = 'array' AND
      jsonb_array_length("checkpoint"->'pending') <= 5000 AND
      jsonb_array_length("checkpoint"->'seen') <= 5000 AND
      (
        ("checkpoint"->>'version')::integer = 1 OR (
          jsonb_typeof("checkpoint"->'sitemapPending') = 'array' AND
          jsonb_typeof("checkpoint"->'sitemapSeen') = 'array' AND
          jsonb_array_length("checkpoint"->'sitemapPending') <= 20 AND
          jsonb_array_length("checkpoint"->'sitemapSeen') <= 20 AND
          jsonb_typeof("checkpoint"->'scopeReady') = 'boolean'
        )
      )
    ) IS TRUE
  );
