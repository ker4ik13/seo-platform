import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260801003000_keyword_research/migration.sql",
  import.meta.url
);

test("keyword research connector boundary is function-only and lease fenced", async () => {
  const sql = await readFile(migration, "utf8");
  for (const signature of [
    "public.claim_keyword_research_run(TEXT, INTEGER)",
    "public.complete_keyword_research_page(",
    "public.fail_keyword_research_run("
  ]) {
    assert.ok(sql.includes(signature));
  }
  assert.match(sql, /SECURITY DEFINER/gu);
  assert.match(sql, /job\.lease_expires_at > clock_timestamp\(\)/u);
  assert.match(sql, /run\.lease_token = p_lease_token/u);
  assert.match(sql, /jsonb_array_length\(p_rows\) > 25/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});
