import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260801144000_frequency_collection_runtime/migration.sql",
  import.meta.url
);

test("frequency connector boundary is exact, function-only and lease fenced", async () => {
  const sql = await readFile(migration, "utf8");
  for (const signature of [
    "public.claim_frequency_collection_item(TEXT, INTEGER)",
    "public.complete_frequency_collection_item(UUID, UUID, TEXT, INTEGER, INTEGER)",
    "public.fail_frequency_collection_item(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER)"
  ]) {
    assert.ok(sql.includes(signature));
  }
  assert.match(sql, /SECURITY DEFINER/gu);
  assert.match(sql, /job\.lease_expires_at > clock_timestamp\(\)/gu);
  assert.match(sql, /job\.version = p_job_version/gu);
  assert.match(sql, /credential\.capabilities \? 'WORDSTAT'/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});
