import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260911124500_failed_operation_dismissal/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("failed-operation dismissal is paired, terminal-only and indexed", () => {
  assert.match(migration, /ADD COLUMN "dismissed_at" TIMESTAMPTZ\(6\)/u);
  assert.match(migration, /ADD COLUMN "dismissed_by" UUID/u);
  assert.match(migration, /FAILED_FINAL.+ACTION_REQUIRED.+EXPIRED/su);
  assert.match(migration, /jobs_project_dismissed_created_idx/u);
  assert.doesNotMatch(migration, /DELETE FROM "jobs"/u);
});
