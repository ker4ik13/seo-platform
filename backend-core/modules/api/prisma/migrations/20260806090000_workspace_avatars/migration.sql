ALTER TABLE "workspaces"
  ADD COLUMN "avatar_mime_type" VARCHAR(32),
  ADD COLUMN "avatar_data" BYTEA,
  ADD COLUMN "avatar_updated_at" TIMESTAMPTZ(6);

ALTER TABLE "workspaces"
  ADD CONSTRAINT "workspaces_avatar_complete_check"
  CHECK (
    ("avatar_mime_type" IS NULL AND "avatar_data" IS NULL AND "avatar_updated_at" IS NULL)
    OR
    (
      "avatar_mime_type" IS NOT NULL
      AND "avatar_data" IS NOT NULL
      AND "avatar_updated_at" IS NOT NULL
      AND "avatar_mime_type" IN ('image/png', 'image/jpeg', 'image/webp')
      AND octet_length("avatar_data") BETWEEN 32 AND 524288
    )
  );
