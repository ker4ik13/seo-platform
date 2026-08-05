import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260805104500_project_connector_route_retirement/migration.sql",
  import.meta.url
);

test("retired project routes preserve history without occupying an active position", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(
    migration,
    /ADD COLUMN retired_at TIMESTAMPTZ\(6\)/u
  );
  assert.match(
    migration,
    /CREATE UNIQUE INDEX project_connector_routes_tenant_project_binding_position_key[\s\S]*WHERE retired_at IS NULL/u
  );
  assert.equal(
    /DROP (?:TABLE|CONSTRAINT)[\s\S]*rank_connector_executions/u.test(
      migration
    ),
    false
  );
});
