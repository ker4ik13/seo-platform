import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const MIGRATION = new URL(
  "../../prisma/migrations/20260826173000_arsenkin_keyword_research_capability/migration.sql",
  import.meta.url
);

test("separates provider Wordstat expansion from ordinary frequency routing", async () => {
  const sql = await readFile(MIGRATION, "utf8");
  const normalized = sql.replaceAll(/\s+/gu, " ").trim();

  assert.match(
    normalized,
    /\["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","CLUSTERING","KEYWORD_RESEARCH"\]/u
  );
  assert.match(
    normalized,
    /\["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT","KEYWORD_RESEARCH"\]/u
  );
  assert.ok(
    normalized.includes("NOT NEW.\"capabilities\" ? 'KEYWORD_RESEARCH'")
  );
  assert.ok(
    normalized.includes(
      "WHEN ''ARSENKIN_WORDSTAT'' THEN ''KEYWORD_RESEARCH''"
    )
  );
  assert.ok(
    normalized.includes(
      "WHEN ''XMLSTOCK_WORDSTAT'' THEN ''KEYWORD_RESEARCH''"
    )
  );
  assert.match(
    normalized,
    /UPDATE public\.integration_credentials SET .*\["KEYWORD_RESEARCH"\].*WHERE "provider" IN \('ARSENKIN', 'XMLSTOCK'\).*"status" = 'ACTIVE'.*"verified_at" IS NOT NULL.*"deleted_at" IS NULL/u
  );
  assert.match(
    normalized,
    /INSERT INTO public\.project_connector_bindings .*'KEYWORD_RESEARCH'/u
  );
  assert.match(
    normalized,
    /INSERT INTO public\.project_connector_routes .*credential_id/u
  );
  assert.match(
    normalized,
    /CREATE FUNCTION public\.complete_xmlstock_wordstat_research_seed/u
  );
  assert.doesNotMatch(sql, /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u);
});
