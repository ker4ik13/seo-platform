import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("XMLStock candidate prefetch does not probe the execution history twice", async () => {
  const sql = await readFile(new URL(
    "../../prisma/migrations/20260929233000_rank_submit_candidate_single_scan/migration.sql",
    import.meta.url
  ), "utf8");
  assert.match(sql, /list_rank_connector_submit_candidates/u);
  assert.match(sql, /IF NOT EXISTS \(/u);
  assert.match(sql, /end_marker CONSTANT TEXT := '  RETURN QUERY'/u);
  assert.match(sql, /substring\(definition FROM 1 FOR start_at - 1\)/u);
  assert.match(sql, /Unexpected rank submit candidate precheck before single scan/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
});
