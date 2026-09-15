import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260914131500_semantic_import_project_domain/migration.sql",
  import.meta.url
);

test("adds the trusted import project domain without blocking legacy rows", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(
    sql,
    /ALTER TABLE "semantic_imports"[\s\S]*ADD COLUMN "project_domain" VARCHAR\(253\)/u
  );
  assert.doesNotMatch(sql, /project_domain" VARCHAR\(253\) NOT NULL/u);
  assert.match(sql, /Trusted normalized project host/u);
});
