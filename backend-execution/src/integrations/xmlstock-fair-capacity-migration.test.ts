import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260928143000_xmlstock_fair_capacity_retry/migration.sql",
  import.meta.url
);

test("revisits Redis capacity without weakening provider failure retries", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /defer_rank_connector_poll_capacity\(uuid,uuid,text,uuid,integer,integer,integer\)/u);
  assert.match(sql, /defer_frequency_collection_batch_capacity\(uuid,uuid\[\],text,integer,integer\)/u);
  assert.match(sql, /p_retry_after_seconds NOT BETWEEN 5 AND 3600/u);
  assert.match(sql, /p_retry_after_seconds NOT BETWEEN 1 AND 3600/u);
  assert.match(sql, /length\(function_definition\)[\s\S]*<> 1/u);
});
