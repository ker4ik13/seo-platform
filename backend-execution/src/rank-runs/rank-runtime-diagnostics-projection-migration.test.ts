import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260826214500_rank_runtime_diagnostics_projection/migration.sql",
  import.meta.url
);

test("runtime diagnostics exposes only the redacted owner-owned projection", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /CREATE FUNCTION public\.read_rank_runtime_diagnostics_entries\(/u
  );
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.read_rank_runtime_diagnostics_entries\([\s\S]*?\) FROM PUBLIC/u
  );
  assert.match(
    sql,
    /GRANT EXECUTE ON FUNCTION public\.read_rank_runtime_diagnostics_entries\(UUID, UUID, UUID, INTEGER\) TO jobs_runtime/u
  );
  assert.doesNotMatch(sql, /provider_request_id/u);
  assert.doesNotMatch(sql, /credential_id/u);
  assert.doesNotMatch(sql, /AS lease_owner/u);
});
