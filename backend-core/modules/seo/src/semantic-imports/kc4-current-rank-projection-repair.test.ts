import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260915114500_kc4_current_rank_projection_repair/migration.sql",
  import.meta.url
);

test("KC4 current-rank repair selects the newest rich snapshot without mutating history", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /context\.status::text = 'ACTIVE'/u);
  assert.match(sql, /snapshot\.provider = 'KEY_COLLECTOR'/u);
  assert.match(sql, /snapshot\.observed_at DESC,[\s\S]*EXISTS \([\s\S]*rank_serp_results/u);
  assert.match(sql, /snapshot\.created_at DESC/u);
  assert.match(sql, /CREATE OR REPLACE FUNCTION "guard_current_rank_mutation"/u);
  assert.match(sql, /NEW\."observed_at" = OLD\."observed_at"/u);
  assert.match(sql, /"new_has_serp" AND NOT "old_has_serp"/u);
  assert.match(sql, /receipt\.applied_at DESC/u);
  assert.match(sql, /configuration_version = chosen\.configuration_version/u);
  assert.match(sql, /snapshot_id = chosen\.id/u);
  assert.match(sql, /data_quality_flags = chosen\.data_quality_flags/u);
  assert.match(sql, /updated_at = chosen\.applied_at/u);
  assert.doesNotMatch(sql, /DELETE\s+FROM\s+rank_snapshots/iu);
  assert.doesNotMatch(sql, /UPDATE\s+rank_snapshots/iu);
});
