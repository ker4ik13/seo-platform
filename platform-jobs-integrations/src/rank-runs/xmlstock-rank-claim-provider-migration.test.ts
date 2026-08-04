import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = readFile(
  new URL(
    "../../prisma/migrations/20260803091000_xmlstock_rank_claim_provider/migration.sql",
    import.meta.url
  ),
  "utf8"
);

function compact(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}

test("generalizes the real pre-authorization claim primitive", async () => {
  const sql = compact(await migration);

  assert.match(sql, /^BEGIN;/u);
  assert.match(sql, /COMMIT;$/u);
  assert.ok(
    sql.includes(
      `claim_rank_connector_execution_pre_authorization(text,integer,text)`
    )
  );
  assert.ok(
    sql.includes(
      `'job."provider" = execution."provider"'`
    )
  );
  assert.ok(
    sql.includes(
      `'credential."provider" = candidate."provider"'`
    )
  );
  assert.ok(
    sql.includes(
      `'control."provider" = current_execution."provider"'`
    )
  );
});

test("keeps rank claim lease and command bounds fail closed", async () => {
  const sql = compact(await migration);

  assert.ok(sql.includes(`'BETWEEN 1 AND 15000'`));
  assert.ok(sql.includes(`'BETWEEN 5 AND 120'`));
  assert.ok(sql.includes(`USING ERRCODE = '55000'`));
  assert.ok(
    sql.includes(
      `IF position('ARSENKIN' IN definition) > 0`
    )
  );
});
