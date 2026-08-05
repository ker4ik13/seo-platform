import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("cross-workspace transfer migration is recoverable and tenant constrained", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260805193000_cross_workspace_project_transfer/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sql, /ADD VALUE 'PROCESSING'/u);
  assert.match(sql, /destination_workspace_id/u);
  assert.match(sql, /source_project_status/u);
  assert.match(sql, /reconcile_version/u);
  assert.match(sql, /WHERE "status" IN \('PENDING', 'PROCESSING'\)/u);
  assert.match(sql, /destination_workspace_id" <> "workspace_id/u);
  assert.match(
    sql,
    /"status" = 'ACCEPTED'[\s\S]*"destination_workspace_id" IS NULL[\s\S]*"destination_workspace_id" IS NOT NULL/u
  );
});
