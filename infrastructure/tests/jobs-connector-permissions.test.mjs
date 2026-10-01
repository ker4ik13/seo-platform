import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const permissionUrl = new URL(
  "../postgres/permissions/jobs-connector.sql",
  import.meta.url
);
const provisionerUrl = new URL(
  "../postgres/permissions/provision-jobs-connector-role.sh",
  import.meta.url
);
const postgresEntrypointUrl = new URL(
  "../postgres/config/start-postgres.sh",
  import.meta.url
);
const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);

const expectedFunctions = [
  "public.list_integration_credential_execution_kek_canaries(TEXT[])",
  "public.list_due_integration_credential_validations(INTEGER)",
  "public.schedule_integration_credential_validation_refreshes( UUID[], TIMESTAMPTZ, JSONB, TEXT, INTEGER )",
  "public.claim_integration_credential_validation(UUID, TEXT, INTEGER)",
  "public.finish_integration_credential_validation_job_failure( UUID, TEXT, UUID, INTEGER, TEXT, INTEGER )",
  "public.finish_integration_credential_validation_provider_failure( UUID, TEXT, UUID, INTEGER, TEXT, TEXT, INTEGER )",
  "public.finish_integration_credential_validation_success( UUID, TEXT, UUID, INTEGER, TEXT, JSONB )",
  "public.authorize_rank_connector_execution_submit( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT )",
  "public.claim_rank_connector_submit_bounded(TEXT, INTEGER, TEXT)",
  "public.list_rank_connector_submit_candidates(TEXT, INTEGER, INTEGER, UUID[])",
  "public.claim_rank_connector_submit_targeted(TEXT, INTEGER, TEXT, UUID)",
  "public.read_rank_connector_submit_request( UUID, UUID, TEXT, UUID, INTEGER, INTEGER )",
  "public.read_rank_connector_billing_settlement( UUID, UUID, TEXT, UUID, INTEGER, INTEGER )",
  "public.complete_rank_connector_submit( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, JSONB, BYTEA, TEXT )",
  "public.claim_rank_connector_poll(TEXT, INTEGER, TEXT)",
  "public.list_rank_connector_poll_candidates(TEXT, INTEGER, UUID[])",
  "public.list_rank_connector_poll_candidates_for_worker(TEXT, INTEGER, UUID[], TEXT)",
  "public.enqueue_remote_work(jsonb,text,text,text,jsonb,text,integer)",
  "public.abandon_remote_work(uuid,uuid)",
  "public.remote_work_available(text)",
  "public.enqueue_remote_work_batch(jsonb)",
  "public.claim_rank_connector_poll_targeted(TEXT, INTEGER, TEXT, UUID)",
  "public.complete_rank_connector_poll( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER, TIMESTAMPTZ, JSONB, BYTEA, TEXT, JSONB, BYTEA )",
  "public.defer_rank_connector_poll_capacity( UUID, UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER )",
  "public.claim_keyword_research_run(TEXT, INTEGER)",
  "public.complete_keyword_research_page( UUID, TEXT, UUID, INTEGER, INTEGER, JSONB, BYTEA, INTEGER, BOOLEAN, JSONB, JSONB )",
  "public.complete_xmlstock_wordstat_research_seed( UUID, TEXT, UUID, INTEGER, INTEGER, JSONB, BYTEA )",
  "public.reserve_xmlstock_wordstat_research_seed( UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER, BOOLEAN )",
  "public.finish_xmlstock_wordstat_research_seed_checkpoint( UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER, TEXT, JSONB, BYTEA, TEXT )",
  "public.skip_unknown_xmlstock_wordstat_research_seed( UUID, TEXT, UUID, INTEGER, INTEGER, INTEGER )",
  "public.mark_keyword_research_submitting( UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER )",
  "public.transition_wordstat_keyword_research_run( UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, TEXT, INTEGER, TEXT, JSONB, BYTEA )",
  "public.fail_keyword_research_run( UUID, TEXT, UUID, INTEGER, INTEGER, TEXT, INTEGER )",
  "public.claim_frequency_collection_item(TEXT, INTEGER)",
  "public.complete_frequency_collection_item(UUID, UUID, TEXT, INTEGER, INTEGER)",
  "public.defer_frequency_collection_item(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER)",
  "public.fail_frequency_collection_item(UUID, UUID, TEXT, INTEGER, TEXT, INTEGER)",
  "public.claim_frequency_collection_batch(TEXT, INTEGER, INTEGER)",
  "public.complete_frequency_collection_batch(UUID, UUID[], TEXT, INTEGER, INTEGER)",
  "public.settle_xmlstock_frequency_batch(UUID, UUID[], TEXT, INTEGER, INTEGER, JSONB, BOOLEAN)",
  "public.defer_frequency_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.fail_frequency_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.mark_frequency_collection_batch_submitting(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.renew_frequency_collection_batch_lease(UUID, UUID[], TEXT, INTEGER, INTEGER)",
  "public.quarantine_frequency_collection_batch_submit(UUID, UUID[], TEXT, INTEGER)",
  "public.defer_frequency_collection_batch_capacity(UUID, UUID[], TEXT, INTEGER, INTEGER)",
  "public.claim_ai_answer_collection_batch(TEXT, INTEGER, INTEGER)",
  "public.renew_ai_answer_collection_batch_lease(UUID, UUID[], TEXT, INTEGER, INTEGER)",
  "public.mark_ai_answer_collection_batch_submitting(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.defer_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.fail_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.defer_ai_answer_collection_batch_capacity(UUID, UUID[], TEXT, INTEGER, INTEGER)",
  "public.quarantine_ai_answer_collection_batch_submit(UUID, UUID[], TEXT, INTEGER)",
  "public.complete_ai_answer_collection_batch(UUID, UUID[], TEXT, INTEGER)",
  "public.claim_clustering_run(TEXT, INTEGER)",
  "public.renew_clustering_run_lease(UUID, UUID[], TEXT, INTEGER, INTEGER)",
  "public.mark_clustering_run_submitting(UUID, UUID[], TEXT, INTEGER, TEXT, INTEGER)",
  "public.transition_clustering_run(UUID, UUID[], TEXT, INTEGER, TEXT, TEXT, INTEGER, TEXT, JSONB)",
  "public.prepare_provider_usage_ticket(uuid,uuid,uuid,text,integer,text,uuid[])",
  "public.start_provider_usage_ticket(uuid,uuid)",
  "public.finish_provider_usage_ticket(uuid,uuid,text,jsonb)",
  "public.read_provider_operation_mode(uuid,uuid,uuid,text,integer)",
  "public.list_enabled_platform_provider_account_ids(text,uuid[])"
];

function compactSql(sql) {
  return sql.replace(/\s+/gu, " ").trim();
}

test("connector role has no direct table access and only exact broker functions", async () => {
  const sql = await readFile(permissionUrl, "utf8");
  const normalized = compactSql(sql);

  assert.match(
    normalized,
    /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I/u
  );
  assert.match(
    normalized,
    /REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM %I/u
  );
  assert.match(
    normalized,
    /REVOKE ALL PRIVILEGES ON ALL ROUTINES IN SCHEMA public FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /REVOKE ALL PRIVILEGES ON DATABASE jobs_db FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /REVOKE ALL PRIVILEGES ON SCHEMA public FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /relation\.relname = '_prisma_migrations' AND relation\.relowner = migration_owner_id/u
  );
  assert.match(
    normalized,
    /routine\.proowner <> migration_owner_id/u
  );
  assert.match(
    normalized,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /ALTER DEFAULT PRIVILEGES FOR ROLE %I IN SCHEMA public REVOKE ALL PRIVILEGES ON SEQUENCES FROM PUBLIC/u
  );
  assert.match(
    normalized,
    /\\getenv connector_user JOBS_CONNECTOR_DATABASE_USER BEGIN; DO/u
  );
  assert.match(normalized, / COMMIT;$/u);
  assert.doesNotMatch(normalized, /GRANT (?:SELECT|UPDATE|INSERT|DELETE) ON/u);
  assert.doesNotMatch(normalized, /GRANT ALL/u);

  for (const signature of expectedFunctions) {
    assert.ok(
      normalized.includes(`GRANT EXECUTE ON FUNCTION ${signature} TO %I`),
      `Missing exact connector grant for ${signature}`
    );
    assert.ok(
      normalized.includes(`'${signature.toLowerCase().replace(/\s+/gu, "")}'::regprocedure::oid`),
      `Missing exact connector ACL allowlist entry for ${signature}`
    );
  }

  assert.equal(
    normalized.match(/GRANT EXECUTE ON FUNCTION/gu)?.length,
    expectedFunctions.length
  );
  assert.doesNotMatch(
    normalized,
    /GRANT EXECUTE ON FUNCTION public\.list_integration_credential_key_versions\(/u
  );
  assert.doesNotMatch(
    normalized,
    /GRANT EXECUTE ON FUNCTION public\.register_integration_credential_kek_canary\(/u
  );
});

test("connector role fails closed on direct ACL outside the exact database allowlist", async () => {
  const sql = await readFile(permissionUrl, "utf8");
  const normalized = compactSql(sql);

  assert.match(normalized, /FROM pg_shdepend dependency/u);
  assert.match(
    normalized,
    /LEFT JOIN pg_database local_database ON local_database\.oid = dependency\.dbid/u
  );
  assert.match(
    normalized,
    /LEFT JOIN pg_database shared_database ON dependency\.dbid = 0 AND dependency\.classid = 'pg_database'::regclass/u
  );
  assert.match(normalized, /dependency\.deptype = 'a'/u);
  assert.match(
    normalized,
    /dependency\.dbid <> 0 AND local_database\.oid IS DISTINCT FROM jobs_database_id/u
  );
  assert.match(
    normalized,
    /dependency\.classid = 'pg_namespace'::regclass AND dependency\.objid = public_schema_id/u
  );
  assert.match(
    normalized,
    /dependency\.classid = 'pg_proc'::regclass AND dependency\.objid = ANY \(allowed_routine_ids\)/u
  );
  assert.match(
    normalized,
    /must not have direct ACL outside jobs_db/u
  );
  assert.match(
    normalized,
    /must not have direct ACL outside the exact jobs_db allowlist/u
  );
  assert.match(
    normalized,
    /FROM pg_namespace namespace WHERE namespace\.nspname <> 'public' AND namespace\.nspname <> 'pg_catalog' AND namespace\.nspname <> 'information_schema'/u
  );
  assert.match(
    normalized,
    /has_schema_privilege\( connector_role_id, namespace\.oid, 'CREATE' \)/u
  );
  assert.match(
    normalized,
    /has_schema_privilege\( connector_role_id, namespace\.oid, 'USAGE' \)/u
  );
  assert.match(
    normalized,
    /must not inherit reachable PUBLIC privileges in non-system jobs_db schemas/u
  );

  assert.equal(
    normalized.match(/REVOKE ALL PRIVILEGES ON DATABASE jobs_db/gu)?.length,
    2
  );
  assert.doesNotMatch(normalized, /REVOKE[^;]+ON DATABASE (?!jobs_db)/u);
});

test("connector role rejects membership edges and streams its password only to psql", async () => {
  const [sql, provisioner] = await Promise.all([
    readFile(permissionUrl, "utf8"),
    readFile(provisionerUrl, "utf8")
  ]);
  const normalized = compactSql(sql);

  assert.match(
    normalized,
    /WHERE member = connector_role_id OR roleid = connector_role_id/u
  );
  assert.match(
    normalized,
    /IF current_database\(\) <> 'jobs_db' THEN RAISE EXCEPTION/u
  );
  assert.doesNotMatch(sql, /JOBS_CONNECTOR_DATABASE_PASSWORD/u);
  assert.doesNotMatch(normalized, /\bPASSWORD\b/u);

  assert.match(
    provisioner,
    /--file="\$script_dir\/jobs-connector\.sql"/u
  );
  const passwordCopyIndex = provisioner.indexOf(
    "connector_password=$JOBS_CONNECTOR_DATABASE_PASSWORD"
  );
  const passwordUnsetIndex = provisioner.indexOf(
    "unset JOBS_CONNECTOR_DATABASE_PASSWORD"
  );
  const firstPsqlIndex = provisioner.indexOf("psql \\");
  assert.ok(passwordCopyIndex >= 0);
  assert.ok(passwordUnsetIndex > passwordCopyIndex);
  assert.ok(firstPsqlIndex > passwordUnsetIndex);
  assert.match(
    provisioner,
    /JOBS_CONNECTOR_DATABASE_PASSWORD must contain 32\.\.512 characters/u
  );
  assert.match(
    provisioner,
    /JOBS_CONNECTOR_DATABASE_PASSWORD must be URL-safe/u
  );
  assert.match(
    provisioner,
    /JOBS_CONNECTOR_DATABASE_PASSWORD must not use an example placeholder/u
  );
  const forceScramIndex = provisioner.indexOf(
    `printf '%s\\n' "SET password_encryption = 'scram-sha-256';"`
  );
  const passwordCommandIndex = provisioner.indexOf(
    `printf "ALTER ROLE %s PASSWORD '%s';\\n"`
  );
  assert.ok(forceScramIndex >= 0);
  assert.ok(passwordCommandIndex > forceScramIndex);
  assert.doesNotMatch(provisioner, /\\password/u);
  assert.match(
    provisioner,
    /printf "ALTER ROLE %s PASSWORD '%s';\\n"[\s\S]*connector_password[\s\S]*\}[\s\S]*\| psql/u
  );
  assert.doesNotMatch(
    provisioner,
    /--command=.*JOBS_CONNECTOR_DATABASE_PASSWORD/u
  );
});

test("generated pg_hba allows connector only into jobs_db before general rules", async () => {
  const connectorRole = "jobs_connector";
  const generated = await runProcess(
    "/bin/sh",
    [fileURLToPath(postgresEntrypointUrl), "--print-hba"],
    {
      ...process.env,
      POSTGRES_USER: "platform",
      JOBS_CONNECTOR_DATABASE_USER: connectorRole
    }
  );
  assert.equal(generated.code, 0, generated.stderr);

  const hostAllowIndex = generated.stdout.search(
    new RegExp(`^host\\s+jobs_db\\s+"${connectorRole}"\\s+all\\s+scram-sha-256$`, "mu")
  );
  const hostReplicationRejectIndex = generated.stdout.search(
    /^host\s+replication\s+\/\^jobs_connector\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  const hostOtherDatabaseRejectIndex = generated.stdout.search(
    /^host\s+all\s+\/\^jobs_connector\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  const hostGeneralIndex = generated.stdout.search(
    /^host\s+all\s+all\s+all\s+scram-sha-256$/mu
  );
  assert.ok(hostAllowIndex >= 0);
  assert.ok(hostReplicationRejectIndex > hostAllowIndex);
  assert.ok(hostOtherDatabaseRejectIndex > hostReplicationRejectIndex);
  assert.ok(hostGeneralIndex > hostOtherDatabaseRejectIndex);

  const localAllowIndex = generated.stdout.search(
    new RegExp(`^local\\s+jobs_db\\s+"${connectorRole}"\\s+scram-sha-256$`, "mu")
  );
  const localOtherDatabaseRejectIndex = generated.stdout.search(
    /^local\s+all\s+\/\^jobs_connector\(_\[a-z0-9_\]\+\)\?\$\s+reject$/mu
  );
  const localGeneralIndex = generated.stdout.search(
    /^local\s+all\s+all\s+trust$/mu
  );
  assert.ok(localAllowIndex >= 0);
  assert.ok(localOtherDatabaseRejectIndex > localAllowIndex);
  assert.ok(localGeneralIndex > localOtherDatabaseRejectIndex);
  assert.doesNotMatch(generated.stdout, /^host\s+.+\s+trust$/mu);

  const compose = await readFile(composeUrl, "utf8");
  assert.match(
    compose,
    /entrypoint:\s*\["\/bin\/sh", "\/postgres-config\/start-postgres\.sh"\]/u
  );
  assert.match(
    compose,
    /command:\s*\[\s*"postgres",\s*"-c",\s*"hba_file=\/tmp\/seo-platform-pg_hba\.conf",\s*"-c",\s*"timezone=UTC"(?:\s*,\s*"[^"\n]*")*\s*\]/u
  );
  assert.match(
    compose,
    /JOBS_CONNECTOR_DATABASE_USER: jobs_connector/u
  );

  for (const invalidRole of [
    "connector,all",
    "9connector",
    "Connector",
    "jobs_connector_",
    "jobs_connector_blue",
    "jobs_other",
    "platform"
  ]) {
    const invalid = await runProcess(
      "/bin/sh",
      [fileURLToPath(postgresEntrypointUrl), "--print-hba"],
      {
        ...process.env,
        POSTGRES_USER: "platform",
        JOBS_CONNECTOR_DATABASE_USER: invalidRole
      }
    );
    assert.notEqual(invalid.code, 0);
    assert.equal(invalid.stdout, "");
  }
});

function runProcess(command, args, environment) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: environment,
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });
  });
}
