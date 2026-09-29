import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank submit prefetch prefers grants with usable lease lifetime", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929223000_rank_submit_fresh_grants/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /ORDER BY execution\.created_at DESC, execution\.id DESC/u);
  assert.match(sql, /eligible\.created_at DESC, eligible\.id DESC/u);
  assert.match(sql, /Unexpected rank submit candidate order before fresh grants/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.list_rank_connector_submit_candidates/u);
});
