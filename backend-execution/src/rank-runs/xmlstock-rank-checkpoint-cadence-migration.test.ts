import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("completed XMLStock Live pages are immediately eligible for the next page", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260826213000_xmlstock_rank_checkpoint_immediate_poll/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(
    sql,
    /v_status = 'POLL_WAIT' AND p_outcome = 'CHECKPOINTED'[\s\S]*THEN v_now/u
  );
  assert.match(
    sql,
    /WHEN v_status = 'POLL_WAIT'[\s\S]*make_interval\(secs => v_delay\)/u
  );
});
