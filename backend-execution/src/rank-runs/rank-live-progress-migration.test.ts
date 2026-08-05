import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260803114500_rank_live_progress/migration.sql",
  import.meta.url
);

test("advances rank job progress once after persisted execution", async () => {
  const sql = await readFile(migration, "utf8");
  const parentLock = sql.indexOf("FROM public.jobs job");
  const executionMutation = sql.indexOf(
    "UPDATE public.rank_connector_executions execution"
  );

  assert.ok(parentLock >= 0);
  assert.ok(executionMutation > parentLock);
  assert.match(sql, /IF p_persisted THEN/u);
  assert.match(sql, /NEW\."version" = OLD\."version"/u);
  assert.match(sql, /to_jsonb\(NEW\) - 'progress_current' - 'updated_at'/u);
  assert.match(sql, /jsonb_array_length\(intent\."request_snapshot"->'keywords'\)/u);
  assert.match(
    sql,
    /job\."progress_current" \+ v_keyword_count/u
  );
  assert.doesNotMatch(sql, /job\."version" \+ 1/u);
  assert.match(sql, /WHERE execution\."status" = 'PERSISTED'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION/u);
});
