import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("SEO project transfer is deferred, parameterized and excludes outbox history", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260805194500_cross_workspace_project_transfer/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sql, /DEFERRABLE INITIALLY IMMEDIATE/u);
  assert.match(sql, /SET CONSTRAINTS ALL DEFERRED/u);
  assert.match(sql, /workspace_id <> ALL \(\$2\)/u);
  assert.match(sql, /relation\.relname <> 'outbox_events'/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/u);
});

test("SEO project transfer re-keys immutable rows only inside the allowlisted routine", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260805225000_project_transfer_immutable_rekey/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sql, /"integrity_workspace_id" UUID/u);
  assert.match(sql, /GENERATED ALWAYS AS \("workspace_id"\) STORED/u);
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /transferable_relations CONSTANT TEXT\[\]/u);
  assert.doesNotMatch(sql, /relation\.relname <> 'outbox_events'/u);
  assert.match(
    sql,
    /current_user = transfer_owner[\s\S]*old_record ->> 'workspace_id' = source_workspace[\s\S]*new_record ->> 'workspace_id' = destination_workspace/u
  );
  assert.match(
    sql,
    /\(old_record - 'workspace_id'\)[\s\S]*IS NOT DISTINCT FROM \(new_record - 'workspace_id'\)/u
  );
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/u);
});
