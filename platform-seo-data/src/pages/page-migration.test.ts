import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260731130000_page_map/migration.sql",
  import.meta.url
);

test("page map migration enforces tenant-safe relations and lifecycle", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(
    sql,
    /FOREIGN KEY \("workspace_id", "project_id", "target_page_id"\)[\s\S]*REFERENCES "pages" \("workspace_id", "project_id", "id"\)/u
  );
  assert.match(
    sql,
    /page_aliases_page_fkey[\s\S]*FOREIGN KEY \("workspace_id", "project_id", "page_id"\)/u
  );
  assert.match(sql, /pages_lifecycle_check/u);
  assert.match(sql, /pages_http_status_check/u);
  assert.match(sql, /page_create_receipts_request_hash_check/u);
});

test("page canonical and alias identities share a serialized DB boundary", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /pg_advisory_xact_lock/u);
  assert.match(sql, /pages_url_identity_trigger/u);
  assert.match(sql, /page_aliases_url_identity_trigger/u);
  assert.match(sql, /ERRCODE = '23505'/u);
  assert.match(
    sql,
    /Cannot add tenant-safe keyword target page FK/u
  );
});
