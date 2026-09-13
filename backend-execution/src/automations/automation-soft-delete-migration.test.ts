import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("rank automation deletion is additive and keeps historical runs", async () => {
  const migration = await readFile(
    new URL(
      "../../prisma/migrations/20260913170000_soft_delete_rank_automations/migration.sql",
      import.meta.url
    ),
    "utf8"
  );

  assert.match(migration, /ADD COLUMN "deleted_at" TIMESTAMPTZ\(6\)/u);
  assert.match(migration, /automations_tenant_active_created_idx/u);
  assert.doesNotMatch(migration, /DELETE FROM|DROP TABLE/u);
});
