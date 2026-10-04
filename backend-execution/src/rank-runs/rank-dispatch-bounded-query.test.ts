import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank dispatch selects only a bounded latest-attempt slice", async () => {
  const source = await readFile(
    new URL("./rank-execution-dispatch.service.ts", import.meta.url),
    "utf8"
  );

  assert.match(source, /LEFT JOIN LATERAL/u);
  assert.match(
    source,
    /ORDER BY\s+execution\."execution_attempt" DESC,[\s\S]*LIMIT 1/u
  );
  assert.match(source, /LIMIT \$\{jobCapacity\}/u);
  assert.match(source, /latest_execution\."authorization_expires_at" <= \$\{now\}/u);
  assert.match(source, /latest_execution\."lease_expires_at" <= \$\{now\}/u);
  assert.doesNotMatch(source, /RANK_UNUSED_AUTHORIZATION_RETRY_DELAY_MS/u);
  assert.match(source, /seo-platform:rank-dispatch:global/u);
  assert.match(source, /LIMIT \$\{hardLimit\}/u);
  assert.match(source, /Math\.min\(dispatchLimit, connectorLaneCount\)/u);
  assert.match(source, /const connectorLaneCount = localConnectorLaneCount/u);
  assert.doesNotMatch(source, /SELECT public\.available_remote_rank_slots\(256\)/u);
  assert.match(source, /XMLSTOCK_UNSUBMITTED_GRANT_WINDOW_PER_JOB/u);
  assert.match(source, /AND \$\{provider\}::text = 'ARSENKIN'/u);
  assert.match(source, /execution\."status" = 'FETCHING'\s+AND \$\{provider\}::text = 'ARSENKIN'/u);
  assert.match(source, /job\."provider" = 'XMLSTOCK'/u);
  assert.match(source, /jobConnectorCount/u);
  assert.match(source, /rankDispatchHardLimit/u);
  assert.doesNotMatch(
    source,
    /transaction\.rankConnectorExecution\.findMany\(\{[\s\S]*?jobId[\s\S]*?select:/u
  );
});
