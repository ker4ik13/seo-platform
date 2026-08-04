import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("stores one 15k positions manifest without invalidating legacy chunks", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260802143000_arsenkin_positions_single_task_15k/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /"pair_count" BETWEEN 1 AND 1000[\s\S]*"chunk_size" = 250/u
  );
  assert.match(
    migration,
    /"pair_count" BETWEEN 1 AND 15000[\s\S]*"chunk_size" = 15000[\s\S]*"chunk_count" = 1/u
  );
  assert.match(
    migration,
    /"persisted_count" BETWEEN 1 AND 15000/u
  );
  assert.match(
    migration,
    /NEW\."sequence" BETWEEN[\s\S]*NEW\."chunk_index" \* "manifest_chunk_size"/u
  );
});
