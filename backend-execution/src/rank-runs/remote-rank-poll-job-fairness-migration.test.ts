import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../../prisma/migrations/20261006100000_remote_rank_poll_job_fairness/migration.sql", import.meta.url),
  "utf8"
);
const jobTurnFix = readFileSync(
  new URL("../../prisma/migrations/20261006103000_remote_rank_poll_job_turn_first/migration.sql", import.meta.url),
  "utf8"
);

test("remote poll takes each Job's first due page before another Job's later pages", () => {
  assert.match(migration, /list_rank_connector_poll_candidates_for_worker/u);
  assert.match(migration, /ORDER BY COALESCE\(active\.active_count, 0\), due\.job_turn, due\.product_turn/u);
  assert.match(migration, /Expected remote rank poll fairness boundary was not found/u);
  assert.match(jobTurnFix, /ORDER BY due\.job_turn, due\.product_turn, COALESCE\(active\.active_count, 0\)/u);
  assert.match(jobTurnFix, /Expected remote rank Job turn boundary was not found/u);
});
