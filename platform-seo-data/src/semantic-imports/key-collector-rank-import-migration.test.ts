import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260803211500_key_collector_rank_import/migration.sql",
  import.meta.url
);

test("Key Collector positions use the immutable rank snapshot path", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  for (const value of ["KEY_COLLECTOR", "IMPORT", "IMPORTED_KC4"]) {
    assert.match(sql, new RegExp(value, "u"));
  }
  for (const constraint of [
    "rank_execution_manifests_provider_operation",
    "rank_execution_manifests_counts",
    "rank_chunk_ingest_receipts_provider_operation",
    "rank_snapshots_provider_source",
    "rank_snapshots_result_shape",
    "rank_snapshots_data_quality_shape",
    "current_ranks_provider_source",
    "current_ranks_result_shape"
  ]) {
    assert.match(sql, new RegExp(`VALIDATE CONSTRAINT "${constraint}"`, "u"));
  }
});
