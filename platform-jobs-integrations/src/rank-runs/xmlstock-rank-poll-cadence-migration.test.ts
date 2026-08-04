import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260802223000_xmlstock_rank_poll_cadence/migration.sql",
  import.meta.url
);

test("delays the first XMLStock rank poll without changing Arsenkin cadence", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /execution\.provider = ''XMLSTOCK''/u);
  assert.match(sql, /interval ''15 seconds''/u);
  assert.match(sql, /ELSE interval ''5 seconds''/u);
  assert.match(sql, /complete_rank_connector_submit/u);
  assert.doesNotMatch(sql, /complete_rank_connector_poll/u);
});
