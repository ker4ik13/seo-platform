ALTER TABLE "uploads"
  ADD COLUMN "part_size_bytes" INTEGER,
  ADD COLUMN "part_count" INTEGER,
  ADD COLUMN "idempotency_key" VARCHAR(180),
  ADD COLUMN "declared_checksum" VARCHAR(128),
  ADD COLUMN "uploaded_at" TIMESTAMPTZ(6),
  ADD COLUMN "aborted_at" TIMESTAMPTZ(6);

ALTER TABLE "uploads"
  ALTER COLUMN "checksum" DROP NOT NULL;

UPDATE "uploads"
SET
  "part_size_bytes" = 8388608,
  "part_count" = GREATEST(
    1,
    CEIL("size_bytes"::numeric / 8388608)::integer
  ),
  "idempotency_key" = 'legacy-' || "id"::text,
  "declared_checksum" = "checksum"
WHERE
  "part_size_bytes" IS NULL
  OR "part_count" IS NULL
  OR "idempotency_key" IS NULL
  OR "declared_checksum" IS NULL;

ALTER TABLE "uploads"
  ALTER COLUMN "part_size_bytes" SET NOT NULL,
  ALTER COLUMN "part_count" SET NOT NULL,
  ALTER COLUMN "idempotency_key" SET NOT NULL;

CREATE UNIQUE INDEX "uploads_workspace_id_actor_id_idempotency_key_key"
  ON "uploads" ("workspace_id", "actor_id", "idempotency_key");
