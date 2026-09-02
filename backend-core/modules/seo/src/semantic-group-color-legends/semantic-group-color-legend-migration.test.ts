import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("adds tenant-scoped color legends, read receipts and transfer coverage", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260902120000_semantic_group_color_legends/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(sql, /CREATE TABLE "semantic_group_color_legends"/u);
  assert.match(sql, /CREATE TABLE "semantic_group_color_legend_reads"/u);
  assert.match(sql, /semantic_group_color_legends_tenant_project_key/u);
  assert.match(sql, /'semantic_group_color_legends'/u);
  assert.match(sql, /ON DELETE CASCADE ON UPDATE RESTRICT/u);
  assert.doesNotMatch(
    sql,
    /\b(?:UPDATE\s+"|DELETE FROM|TRUNCATE|DROP TABLE)\b/u
  );
});
