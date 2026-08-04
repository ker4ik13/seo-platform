import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260802180000_fix_rank_manifest_child_guard_record_fields/migration.sql",
  import.meta.url
);

test("rank manifest child guard reads table-specific fields through JSON", async () => {
  const migration = await readFile(migrationUrl, "utf8");

  assert.match(migration, /"new_row" := to_jsonb\(NEW\)/u);
  assert.match(migration, /"new_row" ->> 'entry_count'/u);
  assert.match(migration, /"new_row" ->> 'sequence'/u);
  assert.doesNotMatch(migration, /NEW\."entry_count"/u);
  assert.doesNotMatch(migration, /NEW\."sequence"/u);
});
