import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260820160000_clustering_top_urls/migration.sql",
  import.meta.url
);

test("stores bounded cluster URL evidence as JSON", async () => {
  const sql = await readFile(MIGRATION, "utf8");

  assert.match(
    sql,
    /ADD COLUMN "top_urls" JSONB NOT NULL DEFAULT '\[\]'::jsonb/u
  );
  assert.match(sql, /jsonb_typeof\("top_urls"\) = 'array'/u);
  assert.match(sql, /jsonb_array_length\("top_urls"\) <= 100/u);
});
