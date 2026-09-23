import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const pollWaitIndex = readFile(
  new URL(
    "../../prisma/migrations/20260923083000_rank_job_poll_due_index/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const fetchingIndex = readFile(
  new URL(
    "../../prisma/migrations/20260923083100_rank_job_fetching_due_index/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const splitClaim = readFile(
  new URL(
    "../../prisma/migrations/20260923083200_rank_poll_split_due_claim/migration.sql",
    import.meta.url
  ),
  "utf8"
);

function compact(sql: string): string {
  return sql.replace(/\s+/gu, " ").trim();
}

test("keeps due poll indexes bounded to non-terminal execution states", async () => {
  const pollSql = compact(await pollWaitIndex);
  const fetchingSql = compact(await fetchingIndex);

  for (const sql of [pollSql, fetchingSql]) {
    assert.match(sql, /CREATE INDEX CONCURRENTLY IF NOT EXISTS/u);
    assert.match(sql, /ON public\.rank_connector_executions \( job_id,/u);
  }
  assert.match(pollSql, /next_action_at/u);
  assert.match(pollSql, /WHERE status = 'POLL_WAIT'/u);
  assert.match(fetchingSql, /lease_expires_at/u);
  assert.match(fetchingSql, /WHERE status = 'FETCHING'/u);
});

test("claims expired leases and scheduled polls through separate lock-safe paths", async () => {
  const sql = await splitClaim;
  const claimStart = sql.indexOf("-- Split the two due states");
  const claimEnd = sql.indexOf("  v_now := clock_timestamp();", claimStart);
  assert.ok(claimStart >= 0 && claimEnd > claimStart);
  const claimSql = sql.slice(claimStart, claimEnd);

  const fetching = claimSql.indexOf("execution.status = 'FETCHING'");
  const pollWait = claimSql.indexOf("execution.status = 'POLL_WAIT'");
  assert.ok(fetching >= 0 && pollWait > fetching);
  assert.equal(
    claimSql.match(/FOR UPDATE OF execution SKIP LOCKED/gu)?.length,
    2
  );
  assert.equal(
    claimSql.match(/job\.cancel_requested_at IS NULL/gu)?.length,
    2
  );
  assert.equal(
    claimSql.match(/job\.version = execution\.job_version/gu)?.length,
    2
  );
  assert.doesNotMatch(
    claimSql,
    /execution\.status = 'POLL_WAIT'[\s\S]*\bOR\b[\s\S]*execution\.status = 'FETCHING'/u
  );
});

test("keeps the poll claim boundary default-closed", async () => {
  const sql = compact(await splitClaim);
  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;$/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.claim_rank_connector_poll\( TEXT, INTEGER, TEXT \) FROM PUBLIC/u
  );
});
