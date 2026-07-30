import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260730160000_preserve_session_family_lineage/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("session lineage backfill is atomic, user-scoped and chooses family minima", () => {
  assert.match(migration, /BEGIN;/u);
  assert.match(
    migration,
    /LOCK TABLE "sessions" IN SHARE ROW EXCLUSIVE MODE;/u
  );
  assert.match(
    migration,
    /MIN\("authenticated_at"\) AS "authenticated_at"/u
  );
  assert.match(migration, /MIN\("expires_at"\) AS "expires_at"/u);
  assert.match(migration, /GROUP BY "user_id", "family_id"/u);
  assert.match(
    migration,
    /"session"\."user_id" = "lineage"\."user_id"/u
  );
  assert.match(
    migration,
    /"session"\."family_id" = "lineage"\."family_id"/u
  );
  assert.match(migration, /COMMIT;/u);
});
