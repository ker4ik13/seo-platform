import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank quota reservations accept the XMLStock SERP policy", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260803080000_xmlstock_rank_quota_policy/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /^BEGIN;/u);
  assert.match(
    sql,
    /LOCK TABLE "rank_execution_quota_reservations" IN ACCESS EXCLUSIVE MODE/u
  );
  assert.match(
    sql,
    /"policy_version" IN \([\s\S]*'manual-arsenkin-positions@1\.0\.0',[\s\S]*'manual-arsenkin-positions@2\.0\.0',[\s\S]*'manual-xmlstock-serp@1\.0\.0'[\s\S]*\)/u
  );
  assert.match(
    sql,
    /VALIDATE CONSTRAINT "rank_quota_reservations_shape_check"/u
  );
  assert.match(sql, /COMMIT;\s*$/u);
});
