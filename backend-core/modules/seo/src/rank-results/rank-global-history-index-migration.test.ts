import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260818130000_rank_snapshot_global_keyword_history/migration.sql",
  import.meta.url
);

test("global keyword rank history index is online and context-independent", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /CREATE INDEX CONCURRENTLY "rank_snapshots_keyword_global_history_idx"/u
  );
  assert.match(
    sql,
    /"workspace_id",\s*"project_id",\s*"keyword_id",\s*"observed_at" DESC,\s*"id" DESC/u
  );
  assert.doesNotMatch(sql, /"tracking_context_id"/u);
});
