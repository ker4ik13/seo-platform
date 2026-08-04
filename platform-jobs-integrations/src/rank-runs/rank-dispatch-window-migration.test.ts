import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260803110000_rank_submit_claim_capacity/migration.sql",
  import.meta.url
);

test("rank submit broker counts claimed work but not its ready queue", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  const activeCount = sql.slice(0, sql.indexOf("INTO active_provider_tasks;"));
  assert.doesNotMatch(activeCount, /execution\.status = 'READY_TO_SUBMIT'/u);
  assert.match(
    sql,
    /execution\.status = 'CLAIMED'[\s\S]*execution\.lease_expires_at > clock_timestamp\(\)/u
  );
  assert.match(
    sql,
    /execution\.status = 'FETCHING'[\s\S]*execution\.lease_expires_at > clock_timestamp\(\)/u
  );
  assert.match(sql, /active_provider_tasks >= 5/u);
  assert.match(
    sql,
    /claim_rank_connector_execution\([\s\S]*p_lease_owner,[\s\S]*p_lease_seconds,[\s\S]*p_execution_connector_version/u
  );
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION public\.claim_rank_connector_submit_bounded/u
  );
});
