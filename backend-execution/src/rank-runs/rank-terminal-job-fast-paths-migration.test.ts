import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank submit fast paths discard terminal parent Jobs before heavy claims", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260923080000_rank_terminal_job_fast_paths/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /JOIN public\.jobs job/gu);
  assert.match(sql, /job\.status = 'QUEUED'/gu);
  assert.match(sql, /job\.status = 'RUNNING'/gu);
  assert.match(sql, /job\.cancel_requested_at IS NULL/gu);
  assert.match(sql, /job\.version = execution\.job_version/gu);
  assert.match(
    sql,
    /claim_rank_connector_execution_pre_authorization\(text,integer,text\)/u
  );
  assert.match(
    sql,
    /claim_rank_connector_submit_bounded\(text,integer,text\)/u
  );
  assert.doesNotMatch(sql, /\b(?:DELETE FROM|TRUNCATE|DROP TABLE)\b/u);
});
