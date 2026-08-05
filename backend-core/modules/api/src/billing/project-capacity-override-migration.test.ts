import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260803153000_project_capacity_overrides/migration.sql",
  import.meta.url
);

test("project capacity override remains tenant-owned and bounded", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /PRIMARY KEY \("workspace_id"\)/u);
  assert.match(sql, /BETWEEN 1 AND 100000/u);
  assert.match(sql, /REFERENCES "workspaces"\("id"\)/u);
  assert.match(sql, /ON DELETE CASCADE/u);
  assert.match(
    sql,
    /REVOKE ALL ON TABLE "project_capacity_overrides" FROM PUBLIC/u
  );
});
