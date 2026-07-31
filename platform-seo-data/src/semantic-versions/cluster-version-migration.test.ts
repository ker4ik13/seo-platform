import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260801050000_cluster_version_changes/migration.sql",
  import.meta.url
);

test("semantic change history allows only keyword and cluster entities", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /CHECK \("entity_type" IN \('KEYWORD', 'CLUSTER'\)\) NOT VALID/u
  );
  assert.match(sql, /VALIDATE CONSTRAINT "semantic_entity_changes_entity_type_v2_check"/u);
  assert.match(sql, /DROP CONSTRAINT "semantic_entity_changes_entity_type_check"/u);
  assert.match(
    sql,
    /RENAME CONSTRAINT "semantic_entity_changes_entity_type_v2_check"[\s\S]*TO "semantic_entity_changes_entity_type_check"/u
  );
});
