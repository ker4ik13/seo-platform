import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("connector reads enabled platform accounts only through a bounded function", async () => {
  const sql = await readFile(
    new URL("../../prisma/migrations/20260918220000_platform_account_enabled_projection/migration.sql", import.meta.url),
    "utf8"
  );
  assert.match(sql, /SECURITY DEFINER/u);
  assert.match(sql, /SET search_path = pg_catalog, pg_temp/u);
  assert.match(sql, /cardinality\(p_account_ids\) NOT BETWEEN 1 AND 64/u);
  assert.match(sql, /account\.enabled/u);
  assert.match(sql, /account\.id = ANY\(p_account_ids\)/u);
  assert.match(sql, /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/u);
});
