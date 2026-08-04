import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260804120000_workspace_invite_decisions/migration.sql",
  import.meta.url
);

test("workspace invitation decisions add a terminal decline audit state", async () => {
  const sql = await readFile(migration, "utf8");

  assert.match(
    sql,
    /ALTER TYPE "WorkspaceInviteStatus" ADD VALUE IF NOT EXISTS 'DECLINED'/u
  );
  assert.match(sql, /ADD COLUMN IF NOT EXISTS "declined_at"/u);
  assert.match(sql, /TIMESTAMPTZ\(6\)/u);
});
