import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260914193000_keyword_merge/migration.sql",
  import.meta.url
);

test("adds tenant-safe keyword aliases to the project transfer allowlist", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /CREATE TABLE "keyword_merges"/u);
  assert.match(sql, /keyword_merges_distinct_keywords_check/u);
  assert.match(sql, /keyword_merges_source_tenant_fkey/u);
  assert.match(sql, /keyword_merges_target_tenant_fkey/u);
  assert.match(sql, /'keyword_merges'/u);
  assert.match(sql, /COMMIT;\s*$/u);
});
