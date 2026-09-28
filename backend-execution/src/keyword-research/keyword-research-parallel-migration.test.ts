import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../../prisma/migrations/20260928150000_parallel_xmlstock_wordstat_research/migration.sql",
  import.meta.url
);

test("XMLStock Wordstat seed evidence is fenced and never blindly retried", async () => {
  const sql = await readFile(migrationUrl, "utf8");
  assert.match(sql, /CREATE TABLE public\.keyword_research_seed_checkpoints/u);
  assert.match(sql, /PRIMARY KEY \(run_id, seed_index\)/u);
  assert.match(sql, /state IN \('STARTED', 'ACCEPTED', 'REJECTED', 'UNKNOWN'\)/u);
  assert.match(sql, /run\.lease_token = p_lease_token/u);
  assert.match(sql, /job\.lease_owner = p_lease_owner/u);
  assert.match(sql, /checkpoint\.state = 'STARTED' THEN[\s\S]*SET state = 'UNKNOWN'/u);
  assert.match(sql, /THEN 'READY_TO_IMPORT'::public\."KeywordResearchStatus"/u);
  assert.match(sql, /skip_unknown_xmlstock_wordstat_research_seed/u);
  assert.match(sql, /ALTER TABLE public\.keyword_research_seed_checkpoints ENABLE ROW LEVEL SECURITY/u);
  assert.match(sql, /prepare_provider_usage_ticket\(uuid,uuid,uuid,text,integer,text,uuid\[\]\)/u);
  assert.match(sql, /r\.max_keywords - r\.collected_keywords/u);
});
