import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260911113000_arsenkin_shared_submit_lock/migration.sql",
  import.meta.url
);

test("restores one Arsenkin submit lock across rank and frequency", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(
    sql,
    /claim_rank_connector_submit_bounded\(text,integer,text\)/u
  );
  assert.match(sql, /seo-platform:rank-submit:/u);
  assert.match(sql, /seo-platform:rank-dispatch:ARSENKIN/u);
  assert.match(sql, /occurrence_count <> 1/u);
  assert.match(sql, /pg_get_functiondef/u);
  assert.doesNotMatch(sql, /CREATE FUNCTION/u);
});
