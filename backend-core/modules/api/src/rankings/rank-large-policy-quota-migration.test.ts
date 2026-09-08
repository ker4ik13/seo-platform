import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("quota reservations admit both large rank policies without rewriting receipts", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260908122000_rank_quota_large_policies/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  for (const policy of [
    "manual-arsenkin-positions@1.0.0",
    "manual-arsenkin-positions@2.0.0",
    "manual-arsenkin-positions@3.0.0",
    "manual-xmlstock-serp@1.0.0",
    "manual-xmlstock-serp@2.0.0"
  ]) {
    assert.match(sql, new RegExp(policy.replaceAll(".", "\\."), "u"));
  }
  assert.match(sql, /ADD CONSTRAINT "rank_quota_reservations_shape_check"/u);
  assert.match(sql, /VALIDATE CONSTRAINT "rank_quota_reservations_shape_check"/u);
  assert.doesNotMatch(sql, /\b(?:UPDATE|DELETE FROM|TRUNCATE|DROP TABLE)\b/u);
});
