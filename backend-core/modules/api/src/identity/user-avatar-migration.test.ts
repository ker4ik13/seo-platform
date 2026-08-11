import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260811230000_user_avatars/migration.sql",
  import.meta.url
);

test("account avatar storage is nullable, complete, typed and bounded", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /ADD COLUMN "avatar_data" BYTEA/u);
  assert.match(sql, /"users_avatar_complete_check"/u);
  assert.match(sql, /octet_length\("avatar_data"\) BETWEEN 32 AND 524288/u);
  assert.match(sql, /'image\/png'/u);
  assert.match(sql, /'image\/jpeg'/u);
  assert.match(sql, /'image\/webp'/u);
  assert.match(
    sql,
    /"avatar_mime_type" IS NULL AND "avatar_data" IS NULL AND "avatar_updated_at" IS NULL/u
  );
});
