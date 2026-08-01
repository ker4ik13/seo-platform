import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260801143000_frequency_snapshot_job_idempotency/migration.sql",
  import.meta.url
);

test("frequency snapshot migration fails closed before adding job idempotency", async () => {
  const sql = await readFile(migration, "utf8");
  const duplicateGuard = sql.indexOf("IF EXISTS");
  const index = sql.indexOf("CREATE UNIQUE INDEX");
  assert.ok(duplicateGuard > 0);
  assert.ok(index > duplicateGuard);
  assert.match(
    sql,
    /workspace_id,\s*project_id,\s*job_id,\s*keyword_id,\s*type,\s*region_code,\s*device/u
  );
  assert.match(sql, /quality_flags JSONB NOT NULL DEFAULT '\[\]'::jsonb/u);
  assert.match(sql, /quality_flags <@ '\["CONTEXT_INCOMPLETE","STALE","PARTIAL","ESTIMATED"\]'::jsonb/u);
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
