import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("BYOK submit gets a claimable grant window without shortening paid leases", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929220000_byok_rank_submit_lease/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /credential\.mode = 'BYOK_API_KEY'[\s\S]*LEAST\(p_lease_seconds, 17\)/u);
  assert.match(sql, /ELSE p_lease_seconds/u);
  assert.match(sql, /claim_rank_connector_submit_targeted\(text,integer,text,uuid\)/u);
  assert.match(sql, /Unexpected targeted submit claim before BYOK lease/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_rank_connector_submit_candidates/u);
});
