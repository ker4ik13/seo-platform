import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260801190000_multi_provider_frequency_runtime/migration.sql",
  import.meta.url
);

test("frequency runtime supports exact XMLStock and Arsenkin routes", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /credential\.provider = job_row\.provider/u);
  assert.match(sql, /credential\.provider IN \('XMLSTOCK', 'ARSENKIN'\)/u);
  assert.match(sql, /credential\.capabilities \? 'WORDSTAT'/u);
  assert.match(sql, /provider_request_id IS NULL OR provider_request_id = p_provider_request_id/u);
  assert.match(sql, /job\.lease_expires_at > clock_timestamp\(\)/gu);
  assert.match(sql, /job\.version = p_job_version/gu);
  assert.ok(
    sql.includes(
      "public.defer_frequency_collection_item(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER)"
    )
  );
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});
