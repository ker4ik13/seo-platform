import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank operation presentation migration preserves immutable Jobs", async () => {
  const sql = await readFile(
    new URL(
      "../../prisma/migrations/20260805190000_rank_operation_presentation/migration.sql",
      import.meta.url
    ),
    "utf8"
  );
  assert.match(sql, /scope_snapshot is immutable/u);
  assert.doesNotMatch(sql, /UPDATE\s+"jobs"/iu);
  assert.doesNotMatch(sql, /ALTER\s+TABLE/iu);
});
