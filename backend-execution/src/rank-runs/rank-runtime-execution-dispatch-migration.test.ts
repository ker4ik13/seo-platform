import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801200000_rank_runtime_execution_dispatch/migration.sql",
  import.meta.url
);

test("rank worker may persist only the missing execution start column", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /GRANT UPDATE \(started_at\)\s+ON TABLE public\.jobs\s+TO jobs_rank_runtime/u
  );
  assert.doesNotMatch(sql, /GRANT (?:ALL|UPDATE) ON TABLE public\.jobs/u);
});
