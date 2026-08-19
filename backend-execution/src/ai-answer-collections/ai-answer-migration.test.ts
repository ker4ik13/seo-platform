import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../../prisma/migrations/20260819171500_arsenkin_ai_answer_collection/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const brokerMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260819180000_ai_answer_connector_broker/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const validationCapabilityMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260819183000_arsenkin_serp_collection_validation_capability/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const claimAmbiguityFixMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260819184500_fix_ai_answer_claim_attempt_ambiguity/migration.sql",
    import.meta.url
  ),
  "utf8"
);
const claimReturnTypeFixMigration = readFileSync(
  new URL(
    "../../prisma/migrations/20260819185000_fix_ai_answer_claim_return_types/migration.sql",
    import.meta.url
  ),
  "utf8"
);

test("adds AI answers to the shared fenced Arsenkin provider capacity", () => {
  assert.match(migration, /capabilities \|\| '\["SERP_COLLECTION"\]'/u);
  assert.match(
    migration,
    /mark_frequency_collection_batch_submitting\(uuid,uuid\[\],text,integer,text,integer\)/u
  );
  assert.match(migration, /claim_rank_connector_submit_bounded\(text,integer,text\)/u);
  assert.equal(
    (migration.match(/''FREQUENCY_COLLECTION'', ''AI_ANSWER_COLLECTION''/gu) ?? []).length,
    2
  );
});

test("keeps AI answer runtime behind fenced connector broker functions", () => {
  for (const routine of [
    "claim_ai_answer_collection_batch",
    "renew_ai_answer_collection_batch_lease",
    "mark_ai_answer_collection_batch_submitting",
    "defer_ai_answer_collection_batch",
    "fail_ai_answer_collection_batch",
    "defer_ai_answer_collection_batch_capacity",
    "quarantine_ai_answer_collection_batch_submit",
    "complete_ai_answer_collection_batch"
  ]) {
    assert.match(brokerMigration, new RegExp(`CREATE FUNCTION public\\.${routine}\\(`, "u"));
  }
  assert.match(brokerMigration, /SECURITY DEFINER/gu);
  assert.match(brokerMigration, /SET search_path = pg_catalog, pg_temp/gu);
  assert.match(brokerMigration, /job\.version = p_job_version/gu);
  assert.match(brokerMigration, /route\.id::TEXT = job_row\.scope_snapshot->>'routeId'/u);
  assert.match(brokerMigration, /hashtextextended\('seo-platform:rank-dispatch:ARSENKIN', 0\)/u);
  assert.doesNotMatch(
    brokerMigration,
    /GRANT (?:SELECT|INSERT|UPDATE|DELETE) ON/u
  );
});

test("preserves the AI collection capability after every Arsenkin revalidation", () => {
  assert.match(
    validationCapabilityMigration,
    /\["SERP_RANK_TRACKING","CLUSTERING","INDEXATION"\]/u
  );
  assert.match(
    validationCapabilityMigration,
    /\["SERP_RANK_TRACKING","SERP_COLLECTION","WORDSTAT"\]/u
  );
  assert.match(
    validationCapabilityMigration,
    /finish_integration_credential_validation_success\(uuid,text,uuid,integer,text,jsonb\)/u
  );
  assert.match(
    validationCapabilityMigration,
    /UPDATE public\.integration_credentials/u
  );
  assert.match(
    validationCapabilityMigration,
    /WHERE "provider" = 'ARSENKIN'[\s\S]*AND "deleted_at" IS NULL/u
  );
});

test("qualifies persisted attempt counters in the AI answer batch claim", () => {
  assert.match(
    claimAmbiguityFixMigration,
    /attempt = claimed_item\.attempt \+ 1/u
  );
  assert.match(
    claimAmbiguityFixMigration,
    /attempt = claimed_job\.attempt \+ 1/u
  );
  assert.doesNotMatch(
    claimAmbiguityFixMigration,
    /attempt = attempt \+ 1/u
  );
});

test("casts the AI answer provider request ID to the broker text contract", () => {
  assert.match(
    claimReturnTypeFixMigration,
    /item\.provider_request_id::TEXT/u
  );
  assert.match(
    claimReturnTypeFixMigration,
    /unexpected AI answer batch claim projection/u
  );
  assert.match(
    claimReturnTypeFixMigration,
    /REVOKE ALL ON FUNCTION[\s\S]*FROM PUBLIC/u
  );
});
