import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260924133000_current_rank_configuration_identity/migration.sql",
  import.meta.url
);

test("current rank identity preserves every immutable configuration", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;\s*$/u);
  assert.match(
    sql,
    /PRIMARY KEY \([\s\S]*"keyword_id",[\s\S]*"tracking_context_id",[\s\S]*"configuration_version"/u
  );
  assert.match(
    sql,
    /PARTITION BY[\s\S]*"candidate"\."tracking_context_id",[\s\S]*"candidate"\."configuration_version"/u
  );
  assert.match(sql, /FROM "rank_snapshots" AS "snapshot"/u);
  assert.match(sql, /WHERE "snapshot"\."position_tracking_enabled" = TRUE/u);
  assert.match(sql, /WHERE "projection_order" = 1/u);
  assert.match(
    sql,
    /OLD\."configuration_version"[\s\S]*NEW\."configuration_version"/u
  );
});

test("all current-rank writers conflict on configuration identity", async () => {
  const [rankResultService, importService] = await Promise.all([
    readFile(new URL("./rank-result.service.ts", import.meta.url), "utf8"),
    readFile(
      new URL("../semantic-imports/semantic-import.service.ts", import.meta.url),
      "utf8"
    )
  ]);

  for (const source of [rankResultService, importService]) {
    assert.match(
      source,
      /ON CONFLICT \([\s\S]*[" ]tracking_context_id[" ]*,[\s\S]*[" ]configuration_version[" ]*[\s\S]*\)\s*DO UPDATE/u
    );
  }
});
