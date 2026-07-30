BEGIN;

-- Rotation used to reset both values on every replacement row. Block session
-- writers while deriving the only safe lineage available from retained family
-- history, then make every row agree before the new runtime starts.
LOCK TABLE "sessions" IN SHARE ROW EXCLUSIVE MODE;

WITH "family_lineage" AS MATERIALIZED (
  SELECT
    "user_id",
    "family_id",
    MIN("authenticated_at") AS "authenticated_at",
    MIN("expires_at") AS "expires_at"
  FROM "sessions"
  GROUP BY "user_id", "family_id"
)
UPDATE "sessions" AS "session"
SET
  "authenticated_at" = "lineage"."authenticated_at",
  "expires_at" = "lineage"."expires_at"
FROM "family_lineage" AS "lineage"
WHERE
  "session"."user_id" = "lineage"."user_id"
  AND "session"."family_id" = "lineage"."family_id"
  AND (
    "session"."authenticated_at" IS DISTINCT FROM "lineage"."authenticated_at"
    OR "session"."expires_at" IS DISTINCT FROM "lineage"."expires_at"
  );

COMMIT;
