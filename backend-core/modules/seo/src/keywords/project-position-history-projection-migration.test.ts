import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migrationUrl = new URL(
  "../../prisma/migrations/20260915152500_project_position_history_projection/migration.sql",
  import.meta.url
);

test("adds a tenant-scoped persistent position-history projection with revision triggers", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /CREATE TABLE "project_position_history_revisions"/u);
  assert.match(sql, /CREATE TABLE "project_position_history_projections"/u);
  assert.match(
    sql,
    /AFTER INSERT ON "rank_snapshots"[\s\S]*REFERENCING NEW TABLE AS new_rows[\s\S]*FOR EACH STATEMENT/u
  );
  assert.match(
    sql,
    /AFTER UPDATE ON "keywords"[\s\S]*REFERENCING OLD TABLE AS old_rows NEW TABLE AS new_rows[\s\S]*FOR EACH STATEMENT/u
  );
  assert.match(sql, /next_row\.is_tracked IS DISTINCT FROM previous_row\.is_tracked/u);
  assert.match(sql, /'project_position_history_projections'/u);
  assert.match(sql, /'project_position_history_revisions'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION bump_project_position_history_revision/u);
  assert.match(sql, /^BEGIN;[\s\S]*COMMIT;\s*$/u);
});
