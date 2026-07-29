import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260729140000_rank_estimates/migration.sql",
  import.meta.url
);

test("keeps unavailable hashes null and enforces bounded immutable estimates", async () => {
  const migration = await readFile(MIGRATION, "utf8");

  assert.match(
    migration,
    /"semantic_scope_hash" IS NOT NULL[\s\S]*"scope_hash" IS NOT NULL/u
  );
  assert.match(
    migration,
    /"keyword_count" = 1001[\s\S]*"semantic_scope_hash" IS NULL[\s\S]*"scope_hash" IS NULL/u
  );
  assert.match(
    migration,
    /"provider_task_count" = \(\("keyword_count" \+ 249\) \/ 250\)/u
  );
  assert.match(
    migration,
    /"provider" = 'ARSENKIN'[\s\S]*"credential_mode" = 'BYOK_API_KEY'/u
  );
  assert.match(
    migration,
    /pg_column_size\("response_snapshot"\) <= 65536/u
  );
  assert.match(
    migration,
    /"expires_at" = "calculated_at" \+ INTERVAL '5 minutes'/u
  );
});
