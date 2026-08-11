import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260806143000_semantic_keyword_notes_and_negative_presets/migration.sql",
  import.meta.url
);
const matchingMigrationUrl = new URL(
  "../../prisma/migrations/20260811173000_negative_keyword_matching_v2/migration.sql",
  import.meta.url
);

test("negative keyword migration keeps notes bounded and presets tenant-scoped", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /keywords_note_length[\s\S]*char_length\("note"\) BETWEEN 1 AND 4000/u);
  assert.match(sql, /semantic_negative_keyword_presets_tenant_project_id_key/u);
  assert.match(sql, /cardinality\("words"\) BETWEEN 1 AND 500/u);
  assert.match(sql, /semantic_negative_keyword_presets_active_name_key[\s\S]*WHERE "status" = 'ACTIVE'/u);
});

test("negative keyword presets follow an accepted project transfer", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /CREATE OR REPLACE FUNCTION transfer_seo_project_workspace/u);
  assert.match(sql, /transferable_relations CONSTANT TEXT\[\][\s\S]*'semantic_negative_keyword_presets'/u);
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/u);
});

test("negative keyword matching upgrade preserves presets and defaults new flags safely", async () => {
  const sql = await readFile(matchingMigrationUrl, "utf8");

  assert.match(sql, /ADD COLUMN "ignore_word_order" BOOLEAN NOT NULL DEFAULT FALSE/u);
  assert.match(sql, /ADD COLUMN "ignore_punctuation" BOOLEAN NOT NULL DEFAULT FALSE/u);
  assert.match(sql, /'WORD_FORM_FAST'/u);
  assert.match(sql, /'WORD_FORM_PRECISE'/u);
  assert.doesNotMatch(sql, /DELETE|DROP TABLE|TRUNCATE/u);
});
