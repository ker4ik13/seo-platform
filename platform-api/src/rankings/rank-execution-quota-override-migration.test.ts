import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260803114500_rank_execution_quota_overrides/migration.sql",
  import.meta.url
);

test("bounds workspace rank quota overrides and keeps tenant ownership", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /daily_task_limit" BETWEEN 1 AND 1000000/u);
  assert.match(sql, /REFERENCES "workspaces" \("id"\)/u);
  assert.match(sql, /ON DELETE CASCADE/u);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE "rank_execution_quota_overrides" FROM PUBLIC/u
  );
});
