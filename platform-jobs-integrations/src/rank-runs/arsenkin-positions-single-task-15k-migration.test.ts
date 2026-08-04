import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("keeps legacy 250-key runs and adds one 15k positions task", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260802143000_arsenkin_positions_single_task_15k/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    migration,
    /manual-arsenkin-positions@1\.0\.0[\s\S]*"manifest_chunk_size" = 250/u
  );
  assert.match(
    migration,
    /manual-arsenkin-positions@2\.0\.0[\s\S]*"provider_task_count" = 1/u
  );
  assert.match(
    migration,
    /"manifest_pair_count" BETWEEN 1 AND 15000[\s\S]*"manifest_chunk_size" = 15000[\s\S]*"manifest_chunk_count" = 1/u
  );
  assert.match(
    migration,
    /octet_length\("request_snapshot"::text\) <= 67108864/u
  );
});
