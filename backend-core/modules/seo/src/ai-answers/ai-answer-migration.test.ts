import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260819170000_ai_answer_snapshots/migration.sql",
  import.meta.url
);

test("AI answer storage is append-only and project-transfer safe", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /ai_answer_snapshots_keyword_tenant_fkey[\s\S]*ON UPDATE NO ACTION[\s\S]*DEFERRABLE INITIALLY IMMEDIATE/u
  );
  assert.match(
    sql,
    /ai_answer_snapshots_rekey_guarded_update[\s\S]*project_workspace_rekey_allowed/u
  );
  assert.match(sql, /ai_answer_snapshots_immutable_delete/u);
  assert.match(sql, /ai_answer_sources_immutable/u);
  assert.match(sql, /ai_answer_snapshots_no_truncate/u);
  assert.match(sql, /ai_answer_sources_no_truncate/u);
  assert.match(
    sql,
    /transferable_relations CONSTANT TEXT\[\][\s\S]*'ai_answer_snapshots'/u
  );
  assert.match(sql, /ai_answer_snapshots_site_position_check/u);
});
