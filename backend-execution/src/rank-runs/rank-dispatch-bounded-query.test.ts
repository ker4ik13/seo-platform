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
  assert.match(source, /RANK_UNUSED_AUTHORIZATION_RETRY_DELAY_MS/u);
  assert.match(source, /seo-platform:rank-dispatch:global/u);
  assert.match(source, /LIMIT \$\{dispatchLimit\}/u);
  assert.doesNotMatch(
    source,
    /transaction\.rankConnectorExecution\.findMany\(\{[\s\S]*?jobId[\s\S]*?select:/u
  );
});
