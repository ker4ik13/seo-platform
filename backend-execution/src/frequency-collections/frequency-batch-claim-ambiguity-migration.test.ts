import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import test from "node:test";

const migrationsRoot = new URL("../../prisma/migrations/", import.meta.url);
const migrationName = "20260802130000_fix_frequency_batch_claim_attempt_ambiguity";
const limitMigrationName = "20260802140000_arsenkin_wordstat_10000";
const leaseMigrationName = "20260802150000_frequency_collection_lease_window";

test("the newest frequency batch claim definition qualifies the attempt column", async () => {
  const migrations = (await readdir(migrationsRoot))
    .filter((name) => /^\d+_/u.test(name))
    .sort();
  const relevant: string[] = [];
  for (const name of migrations) {
    const sql = await readFile(new URL(`${name}/migration.sql`, migrationsRoot), "utf8");
    if (sql.includes("claim_frequency_collection_batch")) relevant.push(name);
  }

  assert.equal(relevant.at(-1), "20260906214000_paid_operation_claims");
  const paidSql = await readFile(new URL("20260906214000_paid_operation_claims/migration.sql", migrationsRoot), "utf8");
  assert.match(paidSql, /job_row\.billing_quote_id IS NOT NULL/u);
  assert.doesNotMatch(paidSql, /attempt\s*=/u, "The billing patch must preserve the qualified attempt update");
  const sql = await readFile(
    new URL(`${migrationName}/migration.sql`, migrationsRoot),
    "utf8"
  );
  assert.match(
    sql,
    /pg_get_functiondef\([\s\S]*claim_frequency_collection_batch\(text,integer,integer\)/u
  );
  assert.match(sql, /UPDATE public\.job_items AS claimed_item/u);
  assert.match(sql, /attempt = claimed_item\.attempt \+ 1/u);
  assert.match(sql, /unexpected frequency batch claim projection/u);
  assert.match(
    sql,
    /REVOKE ALL ON FUNCTION[\s\S]*claim_frequency_collection_batch/u
  );
  const limitSql = await readFile(
    new URL(`${limitMigrationName}/migration.sql`, migrationsRoot),
    "utf8"
  );
  assert.match(
    limitSql,
    /pg_get_functiondef\(function_signature::regprocedure\)/u
  );
  assert.match(limitSql, /'BETWEEN 1 AND 200',[\s\S]*'BETWEEN 1 AND 10000'/u);
  const leaseSql = await readFile(
    new URL(`${leaseMigrationName}/migration.sql`, migrationsRoot),
    "utf8"
  );
  assert.match(
    leaseSql,
    /pg_get_functiondef\(function_signature::regprocedure\)/u
  );
  assert.match(leaseSql, /'BETWEEN 5 AND 60',[\s\S]*'BETWEEN 5 AND 120'/u);
});
