import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260730190000_semantic_custom_columns/migration.sql",
  import.meta.url
);

test("custom-column migration uses indexed typed values and tenant FKs", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /"integer_value" BIGINT/u);
  assert.match(sql, /"decimal_value" DECIMAL\(30, 10\)/u);
  assert.match(sql, /"date_value" DATE/u);
  assert.match(sql, /USING GIN \("string_array_value"\)/u);
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "keyword_id"\)[\s\S]*REFERENCES "keywords"\("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /semantic_keyword_custom_values_exactly_one[\s\S]*num_nonnulls/u
  );
  assert.match(
    sql,
    /semantic_keyword_custom_value_type_guard[\s\S]*validate_semantic_keyword_custom_value_type/u
  );
  assert.match(
    sql,
    /typed custom-column backfill requires actor provenance[\s\S]*INSERT INTO "semantic_custom_columns"[\s\S]*INSERT INTO "semantic_keyword_custom_values"/u
  );
  assert.doesNotMatch(
    sql,
    /"values"\s+JSONB/u
  );
});
