import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260805204500_rank_submit_capacity_live_graph/migration.sql",
  import.meta.url
);

test("rank submit capacity ignores terminal connector audit history", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  const liveCount = sql.slice(sql.indexOf("$new_capacity$"));

  assert.match(liveCount, /JOIN public\.jobs rank_job/u);
  assert.match(liveCount, /rank_job\.status = 'RUNNING'/u);
  assert.match(liveCount, /rank_job\.stage = 'WAITING_EXECUTION_GRANT'/u);
  assert.match(liveCount, /rank_job\.cancel_requested_at IS NULL/u);
  assert.match(liveCount, /rank_job\.version = execution\.job_version/u);
  assert.match(liveCount, /execution\.provider = provider_name/u);
  assert.match(liveCount, /execution\.status IN \('SUBMITTING', 'POLL_WAIT'\)/u);
  assert.match(liveCount, /execution\.lease_expires_at > clock_timestamp\(\)/u);
  assert.match(sql, /occurrence_count <> 1/u);
});
