BEGIN;

-- Published plan versions stay immutable. Close the first catalog interval
-- and publish version 2 with the collaboration limits approved for launch.
UPDATE "billing_plan_versions"
SET "effective_to" = '2026-08-04T00:00:00Z'
WHERE "version" = 1
  AND "effective_to" IS NULL
  AND "plan_id" IN (
    '019be4c0-0000-7000-8000-000000000001',
    '019be4c0-0000-7000-8000-000000000002',
    '019be4c0-0000-7000-8000-000000000003',
    '019be4c0-0000-7000-8000-000000000004',
    '019be4c0-0000-7000-8000-000000000005',
    '019be4c0-0000-7000-8000-000000000006'
  );

WITH "seat_catalog" ("plan_id", "version_id", "seats") AS (
  VALUES
    ('019be4c0-0000-7000-8000-000000000001'::uuid, '019fc999-0000-7000-8000-000000001001'::uuid, 3),
    ('019be4c0-0000-7000-8000-000000000002'::uuid, '019fc999-0000-7000-8000-000000001002'::uuid, 10),
    ('019be4c0-0000-7000-8000-000000000003'::uuid, '019fc999-0000-7000-8000-000000001003'::uuid, 20),
    ('019be4c0-0000-7000-8000-000000000004'::uuid, '019fc999-0000-7000-8000-000000001004'::uuid, 50),
    ('019be4c0-0000-7000-8000-000000000005'::uuid, '019fc999-0000-7000-8000-000000001005'::uuid, 50),
    ('019be4c0-0000-7000-8000-000000000006'::uuid, '019fc999-0000-7000-8000-000000001006'::uuid, 50)
)
INSERT INTO "billing_plan_versions" (
  "id",
  "plan_id",
  "version",
  "status",
  "effective_from",
  "features",
  "included_data_credits_minor",
  "trial_days",
  "service_description",
  "created_at"
)
SELECT
  "seat_catalog"."version_id",
  "previous"."plan_id",
  2,
  'PUBLISHED',
  '2026-08-04T00:00:00Z',
  "previous"."features" || jsonb_build_object('seats', "seat_catalog"."seats"),
  "previous"."included_data_credits_minor",
  "previous"."trial_days",
  "previous"."service_description",
  CURRENT_TIMESTAMP
FROM "billing_plan_versions" AS "previous"
JOIN "seat_catalog"
  ON "seat_catalog"."plan_id" = "previous"."plan_id"
WHERE "previous"."version" = 1;

WITH "price_catalog" ("price_id", "old_version_id", "new_version_id") AS (
  VALUES
    ('019fc999-0000-7000-8000-000000002001'::uuid, '019be4c0-0000-7000-8000-000000001001'::uuid, '019fc999-0000-7000-8000-000000001001'::uuid),
    ('019fc999-0000-7000-8000-000000002002'::uuid, '019be4c0-0000-7000-8000-000000001002'::uuid, '019fc999-0000-7000-8000-000000001002'::uuid),
    ('019fc999-0000-7000-8000-000000002003'::uuid, '019be4c0-0000-7000-8000-000000001002'::uuid, '019fc999-0000-7000-8000-000000001002'::uuid),
    ('019fc999-0000-7000-8000-000000002004'::uuid, '019be4c0-0000-7000-8000-000000001003'::uuid, '019fc999-0000-7000-8000-000000001003'::uuid),
    ('019fc999-0000-7000-8000-000000002005'::uuid, '019be4c0-0000-7000-8000-000000001003'::uuid, '019fc999-0000-7000-8000-000000001003'::uuid),
    ('019fc999-0000-7000-8000-000000002006'::uuid, '019be4c0-0000-7000-8000-000000001004'::uuid, '019fc999-0000-7000-8000-000000001004'::uuid),
    ('019fc999-0000-7000-8000-000000002007'::uuid, '019be4c0-0000-7000-8000-000000001004'::uuid, '019fc999-0000-7000-8000-000000001004'::uuid),
    ('019fc999-0000-7000-8000-000000002008'::uuid, '019be4c0-0000-7000-8000-000000001005'::uuid, '019fc999-0000-7000-8000-000000001005'::uuid),
    ('019fc999-0000-7000-8000-000000002009'::uuid, '019be4c0-0000-7000-8000-000000001005'::uuid, '019fc999-0000-7000-8000-000000001005'::uuid),
    ('019fc999-0000-7000-8000-000000002010'::uuid, '019be4c0-0000-7000-8000-000000001006'::uuid, '019fc999-0000-7000-8000-000000001006'::uuid),
    ('019fc999-0000-7000-8000-000000002011'::uuid, '019be4c0-0000-7000-8000-000000001006'::uuid, '019fc999-0000-7000-8000-000000001006'::uuid)
), "numbered_prices" AS (
  SELECT
    "price_catalog".*,
    row_number() OVER (
      PARTITION BY "price_catalog"."old_version_id"
      ORDER BY "price_catalog"."price_id"
    ) AS "ordinal"
  FROM "price_catalog"
), "source_prices" AS (
  SELECT
    "id",
    "plan_version_id",
    "period",
    "currency",
    "amount_minor",
    row_number() OVER (
      PARTITION BY "plan_version_id"
      ORDER BY "period", "currency"
    ) AS "ordinal"
  FROM "billing_plan_prices"
  WHERE "plan_version_id" IN (
    SELECT DISTINCT "old_version_id" FROM "price_catalog"
  )
)
INSERT INTO "billing_plan_prices" (
  "id",
  "plan_version_id",
  "period",
  "currency",
  "amount_minor",
  "created_at"
)
SELECT
  "numbered_prices"."price_id",
  "numbered_prices"."new_version_id",
  "source_prices"."period",
  "source_prices"."currency",
  "source_prices"."amount_minor",
  CURRENT_TIMESTAMP
FROM "numbered_prices"
JOIN "source_prices"
  ON "source_prices"."plan_version_id" = "numbered_prices"."old_version_id"
 AND "source_prices"."ordinal" = "numbered_prices"."ordinal";

COMMIT;
