import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260806090000_workspace_avatars/migration.sql",
  import.meta.url
);

test("workspace avatars stay complete, typed and bounded in Core storage", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(sql, /ADD COLUMN "avatar_data" BYTEA/u);
  assert.match(sql, /'image\/png', 'image\/jpeg', 'image\/webp'/u);
  assert.match(sql, /octet_length\("avatar_data"\) BETWEEN 32 AND 524288/u);
  assert.match(sql, /"avatar_mime_type" IS NOT NULL/u);
  assert.match(sql, /"avatar_updated_at" IS NOT NULL/u);
  assert.match(
    sql,
    /"avatar_mime_type" IS NULL AND "avatar_data" IS NULL AND "avatar_updated_at" IS NULL/u
  );
});
