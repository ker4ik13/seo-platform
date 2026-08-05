import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801205000_rank_runtime_id_guard_scope/migration.sql",
  import.meta.url
);

test("rank runtime ID guards do not reject allowlisted domain updates", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  for (const table of [
    "job_items",
    "integration_credentials",
    "project_connector_bindings",
    "project_connector_routes"
  ]) {
    assert.match(
      sql,
      new RegExp(`BEFORE UPDATE OF id ON public\\.${table}`, "u")
    );
  }
  assert.equal(
    (sql.match(/EXECUTE FUNCTION public\.reject_jobs_rank_runtime_id_update\(\)/gu) ?? [])
      .length,
    4
  );
  assert.doesNotMatch(sql, /BEFORE UPDATE ON public\./u);
});
