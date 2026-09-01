import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260901120000_xmlstock_rank_poll_attempt_limit_50/migration.sql",
  import.meta.url
);

test("stops only XMLStock keyword tasks after the fiftieth provider poll", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /^BEGIN;\s/u);
  assert.match(sql, /CASE WHEN execution\.provider = ''XMLSTOCK'' THEN 50 ELSE 720 END/u);
  assert.match(
    sql,
    /CASE WHEN current_execution\.provider = ''XMLSTOCK'' THEN 50 ELSE 720 END/u
  );
  assert.match(sql, /complete_limit_needle\) <> 2/u);
  assert.match(sql, /length\(replace\(claim_definition, claim_select_needle, ''\)\)[\s\S]*length\(claim_select_needle\) <> 1/u);
  assert.match(sql, /position\('execution\.poll_attempt_count >= 50' IN claim_definition\) = 0/u);
  assert.match(sql, /EXECUTE claim_definition/u);
  assert.match(sql, /EXECUTE complete_definition/u);
  assert.match(sql, /\sCOMMIT;\s*$/u);
});

test("terminalizes maxed waiting or expired XMLStock leases without request 51", async () => {
  const sql = await readFile(migrationUrl, "utf8");

  assert.match(sql, /execution\.poll_attempt_count >= 50/u);
  assert.match(
    sql,
    /execution\.status = 'POLL_WAIT'[\s\S]*execution\.status = 'FETCHING'[\s\S]*lease_expires_at <= clock_timestamp\(\)/u
  );
  assert.match(sql, /SET status = 'FAILED_FINAL'/u);
  assert.match(sql, /last_error_code = COALESCE\([\s\S]*'PROVIDER_POLL_TIMEOUT'/u);
  assert.doesNotMatch(
    sql,
    /execution\.provider = 'ARSENKIN'[\s\S]*poll_attempt_count >= 50/u
  );
});
