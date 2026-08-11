CREATE TABLE "project_logos" (
  "project_id" UUID NOT NULL,
  "source" VARCHAR(16),
  "source_domain" VARCHAR(255),
  "content_type" VARCHAR(32),
  "data" BYTEA,
  "image_updated_at" TIMESTAMPTZ(6),
  "discovery_attempted_at" TIMESTAMPTZ(6),
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,

  CONSTRAINT "project_logos_pkey" PRIMARY KEY ("project_id"),
  CONSTRAINT "project_logos_project_id_fkey"
    FOREIGN KEY ("project_id") REFERENCES "projects"("id")
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_logos_image_complete_check" CHECK (
    (
      "source" IS NULL
      AND "content_type" IS NULL
      AND "data" IS NULL
      AND "image_updated_at" IS NULL
    )
    OR
    (
      "source" IN ('CUSTOM', 'DISCOVERED')
      AND "content_type" IN (
        'image/svg+xml',
        'image/png',
        'image/jpeg',
        'image/webp',
        'image/x-icon',
        'image/gif',
        'image/avif'
      )
      AND "data" IS NOT NULL
      AND octet_length("data") BETWEEN 32 AND 524288
      AND "image_updated_at" IS NOT NULL
    )
  ),
  CONSTRAINT "project_logos_source_domain_check" CHECK (
    ("source" = 'CUSTOM' AND "source_domain" IS NULL)
    OR ("source" = 'DISCOVERED' AND "source_domain" IS NOT NULL)
    OR ("source" IS NULL AND "source_domain" IS NOT NULL)
  )
);

CREATE INDEX "project_logos_source_domain_discovery_attempted_at_idx"
  ON "project_logos"("source_domain", "discovery_attempted_at");
