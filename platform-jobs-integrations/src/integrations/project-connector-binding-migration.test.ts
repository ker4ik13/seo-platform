import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260729110000_project_connector_bindings/migration.sql",
  import.meta.url
);

test("locks the legacy binding table before checking and dropping it", async () => {
  const migration = await readFile(MIGRATION, "utf8");
  const lock = migration.indexOf(
    'LOCK TABLE "integration_bindings" IN ACCESS EXCLUSIVE MODE;'
  );
  const precondition = migration.indexOf(
    'IF EXISTS (SELECT 1 FROM "integration_bindings")'
  );
  const drop = migration.indexOf('DROP TABLE "integration_bindings";');

  assert.ok(lock >= 0);
  assert.ok(precondition > lock);
  assert.ok(drop > precondition);
});
