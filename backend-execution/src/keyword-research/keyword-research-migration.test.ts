import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../../prisma/migrations/20260801003000_keyword_research/migration.sql",
  import.meta.url
);
const expansionMigration = new URL(
  "../../prisma/migrations/20260826160000_keys_so_wordstat_expansion/migration.sql",
  import.meta.url
);
const capabilityMigration = new URL(
  "../../prisma/migrations/20260826173000_arsenkin_keyword_research_capability/migration.sql",
  import.meta.url
);
const rowDestinationsMigration = new URL(
  "../../prisma/migrations/20260826190000_keyword_research_row_destinations/migration.sql",
  import.meta.url
);

test("keyword research connector boundary is function-only and lease fenced", async () => {
  const sql = await readFile(migration, "utf8");
  for (const signature of [
    "public.claim_keyword_research_run(TEXT, INTEGER)",
    "public.complete_keyword_research_page(",
    "public.fail_keyword_research_run("
  ]) {
    assert.ok(sql.includes(signature));
  }
  assert.match(sql, /SECURITY DEFINER/gu);
  assert.match(sql, /job\.lease_expires_at > clock_timestamp\(\)/u);
  assert.match(sql, /run\.lease_token = p_lease_token/u);
  assert.match(sql, /jsonb_array_length\(p_rows\) > 25/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});

test("Wordstat expansion keeps provider submission fenced and capacity shared", async () => {
  const sql = await readFile(expansionMigration, "utf8");
  const capabilitySql = await readFile(capabilityMigration, "utf8");
  for (const signature of [
    "public.mark_keyword_research_submitting(",
    "public.transition_wordstat_keyword_research_run(",
    "pg_advisory_xact_lock",
    "provider_task_id ~ '^submitting:'",
    "active_provider_tasks >= 5"
  ]) {
    assert.ok(sql.includes(signature));
  }
  assert.match(sql, /run\.lease_token = p_lease_token/gu);
  assert.match(sql, /job\.lease_expires_at > clock_timestamp\(\)/gu);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.mark_keyword_research_submitting/gu);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/gu);
  assert.match(
    capabilitySql,
    /WHEN ''ARSENKIN_WORDSTAT'' THEN ''KEYWORD_RESEARCH''/u
  );
  assert.match(
    capabilitySql,
    /WHEN ''XMLSTOCK_WORDSTAT'' THEN ''KEYWORD_RESEARCH''/u
  );
  assert.match(
    capabilitySql,
    /complete_xmlstock_wordstat_research_seed/u
  );
});

test("Wordstat import stores an optional destination for each preview row", async () => {
  const sql = await readFile(rowDestinationsMigration, "utf8");
  assert.match(sql, /ALTER TABLE "keyword_research_rows"/u);
  assert.match(sql, /"target_group_path" VARCHAR\(2048\)/u);
  assert.match(sql, /"distribution_mode" VARCHAR\(32\) NOT NULL/u);
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/gu);
});
