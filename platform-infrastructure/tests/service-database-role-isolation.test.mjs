import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import test from "node:test";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
const envUrl = new URL("../../.env.example", import.meta.url);
const entrypointUrl = new URL(
  "../postgres/config/start-postgres.sh",
  import.meta.url
);
const roleBootstrapSqlUrl = new URL(
  "../postgres/roles/bootstrap-service-database-roles.sql",
  import.meta.url
);
const roleProvisionerUrl = new URL(
  "../postgres/roles/provision-service-database-roles.sh",
  import.meta.url
);
const runtimeSqlUrl = new URL(
  "../postgres/permissions/service-runtime.sql",
  import.meta.url
);
const extensionSqlUrl = new URL(
  "../postgres/permissions/seo-extension-runtime.sql",
  import.meta.url
);

const mappings = [
  {
    database: "platform_db",
    owner: "platform_owner",
    ownerSecret: "PLATFORM_DATABASE_OWNER_PASSWORD",
    runtime: "platform_runtime",
    runtimeSecret: "PLATFORM_DATABASE_PASSWORD"
  },
  {
    database: "seo_db",
    owner: "seo_owner",
    ownerSecret: "SEO_DATABASE_OWNER_PASSWORD",
    runtime: "seo_runtime",
    runtimeSecret: "SEO_DATABASE_PASSWORD"
  },
  {
    database: "jobs_db",
    owner: "jobs_owner",
    ownerSecret: "JOBS_DATABASE_OWNER_PASSWORD",
    runtime: "jobs_runtime",
    runtimeSecret: "JOBS_DATABASE_PASSWORD"
  },
  {
    database: "realtime_db",
    owner: "realtime_owner",
    ownerSecret: "REALTIME_DATABASE_OWNER_PASSWORD",
    runtime: "realtime_runtime",
    runtimeSecret: "REALTIME_DATABASE_PASSWORD"
  }
];

function compact(value) {
  return value.replace(/\s+/gu, " ").trim();
}

function serviceBlock(compose, serviceName) {
  const startMarker = `\n  ${serviceName}:\n`;
  const start = compose.indexOf(startMarker);
  assert.ok(start >= 0, `Missing Compose service ${serviceName}`);
  const contentStart = start + startMarker.length;
  const next = compose.slice(contentStart).search(/^  [a-z0-9][a-z0-9-]+:\n/mu);
  return next < 0
    ? compose.slice(contentStart)
    : compose.slice(contentStart, contentStart + next);
}

test("Compose splits migration owners from fixed runtime roles", async () => {
  const compose = await readFile(composeUrl, "utf8");

  const migrationServices = [
    ["platform-api-migrate", mappings[0]],
    ["seo-data-migrate", mappings[1]],
    ["jobs-integrations-migrate", mappings[2]],
    ["realtime-migrate", mappings[3]]
  ];
  for (const [serviceName, mapping] of migrationServices) {
    const block = serviceBlock(compose, serviceName);
    assert.match(
      block,
      new RegExp(
        `DATABASE_URL: postgresql://${mapping.owner}:\\$\\{${mapping.ownerSecret}:\\?[^}]+\\}@postgres:5432/${mapping.database}`,
        "u"
      )
    );
    assert.doesNotMatch(block, /POSTGRES_(?:USER|PASSWORD)/u);
    assert.match(
      block,
      /service-database-roles:\s+condition: service_completed_successfully/u
    );
  }

  const directRuntimeServices = [
    ["platform-api", mappings[0]],
    ["seo-data", mappings[1]],
    ["rank-worker", mappings[2]],
    ["realtime", mappings[3]]
  ];
  for (const [serviceName, mapping] of directRuntimeServices) {
    const block = serviceBlock(compose, serviceName);
    assert.match(
      block,
      new RegExp(
        `DATABASE_URL: postgresql://${mapping.runtime}:\\$\\{${mapping.runtimeSecret}:\\?[^}]+\\}@postgres:5432/${mapping.database}`,
        "u"
      )
    );
    assert.doesNotMatch(block, /POSTGRES_(?:USER|PASSWORD)/u);
  }

  assert.match(
    compose,
    /x-jobs-env:[\s\S]*?DATABASE_URL: postgresql:\/\/jobs_runtime:\$\{JOBS_DATABASE_PASSWORD:\?[^}]+\}@postgres:5432\/jobs_db/u
  );

  for (const serviceName of [
    "jobs-integrations",
    "system-worker",
    "upload-inspection-worker",
    "import-worker"
  ]) {
    const block = serviceBlock(compose, serviceName);
    assert.doesNotMatch(block, /POSTGRES_(?:USER|PASSWORD)/u);
    assert.match(
      block,
      /jobs-runtime-db-permissions:\s+condition: service_completed_successfully/u
    );
  }

  const connector = serviceBlock(compose, "connector-worker");
  assert.match(connector, /postgresql:\/\/jobs_connector:/u);
  assert.doesNotMatch(connector, /POSTGRES_(?:USER|PASSWORD)/u);

  const directus = serviceBlock(compose, "directus");
  assert.match(directus, /DB_USER: directus_runtime_owner/u);
  assert.match(
    directus,
    /DB_PASSWORD: \$\{DIRECTUS_DATABASE_PASSWORD:\?[^}]+\}/u
  );
  assert.doesNotMatch(directus, /POSTGRES_(?:USER|PASSWORD)/u);
  assert.match(
    directus,
    /service-database-roles:\s+condition: service_completed_successfully/u
  );

  assert.doesNotMatch(
    compose,
    /DATABASE_URL: postgresql:\/\/\$\{POSTGRES_USER\}/u
  );
  assert.doesNotMatch(compose, /DB_USER: \$\{POSTGRES_USER\}/u);
});

test("bootstrap and post-migration provisioners are secret-safe and fail closed", async () => {
  const [bootstrapSql, provisioner, runtimeSql, extensionSql, env] =
    await Promise.all([
      readFile(roleBootstrapSqlUrl, "utf8"),
      readFile(roleProvisionerUrl, "utf8"),
      readFile(runtimeSqlUrl, "utf8"),
      readFile(extensionSqlUrl, "utf8"),
      readFile(envUrl, "utf8")
    ]);
  const normalizedRuntimeSql = compact(runtimeSql);

  assert.doesNotMatch(bootstrapSql, /\bPASSWORD\b/u);
  assert.match(provisioner, /unset PLATFORM_DATABASE_OWNER_PASSWORD/u);
  assert.match(provisioner, /unset DIRECTUS_DATABASE_PASSWORD/u);
  assert.match(provisioner, /service database passwords must be URL-safe/u);
  assert.match(provisioner, /service database passwords must be pairwise distinct/u);
  assert.match(provisioner, /--command='\\password :"role_name"'/u);
  assert.match(
    provisioner,
    /printf '%s\\n%s\\n' "\$role_password" "\$role_password" \|/u
  );
  assert.doesNotMatch(provisioner, /--command=.*DATABASE_.*PASSWORD/u);

  for (const mapping of mappings) {
    assert.match(bootstrapSql, new RegExp(`'${mapping.owner}'`, "u"));
    assert.match(bootstrapSql, new RegExp(`'${mapping.runtime}'`, "u"));
    assert.match(env, new RegExp(`^${mapping.ownerSecret}=`, "mu"));
    assert.match(env, new RegExp(`^${mapping.runtimeSecret}=`, "mu"));
  }
  assert.match(bootstrapSql, /'directus_runtime_owner'/u);
  assert.match(env, /^DIRECTUS_DATABASE_PASSWORD=/mu);
  assert.match(
    bootstrapSql,
    /NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOREPLICATION NOBYPASSRLS/u
  );
  assert.match(bootstrapSql, /member = service_role_id\s+OR roleid = service_role_id/u);

  assert.match(normalizedRuntimeSql, /BEGIN; SELECT CASE current_database\(\)/u);
  assert.match(normalizedRuntimeSql, /COMMIT;$/u);
  assert.match(
    normalizedRuntimeSql,
    /GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE %I\.%I TO %I/u
  );
  assert.match(
    normalizedRuntimeSql,
    /GRANT USAGE, SELECT ON SEQUENCE %I\.%I TO %I/u
  );
  assert.match(normalizedRuntimeSql, /relation\.relname <> '_prisma_migrations'/u);
  assert.match(normalizedRuntimeSql, /runtime service role retained DDL privileges/u);
  assert.match(normalizedRuntimeSql, /must not access Prisma migration history/u);
  assert.doesNotMatch(normalizedRuntimeSql, /GRANT (?:CREATE|TEMPORARY|TRUNCATE|REFERENCES|TRIGGER)/u);
  assert.doesNotMatch(normalizedRuntimeSql, /GRANT ALL/u);
  assert.match(
    normalizedRuntimeSql,
    /public\.list_integration_credential_key_versions\(\)/u
  );
  assert.match(
    normalizedRuntimeSql,
    /public\.register_integration_credential_kek_canary/u
  );

  assert.match(extensionSql, /extension_record\.extname = 'pg_trgm'/u);
  assert.match(extensionSql, /REVOKE ALL PRIVILEGES ON FUNCTION %s FROM PUBLIC/u);
  assert.match(extensionSql, /GRANT EXECUTE ON FUNCTION %s TO seo_runtime/u);
  assert.match(extensionSql, /acl\.grantee = 0/u);
});

test("generated HBA permits only exact own-database roles before family rejects", async () => {
  const generated = await runProcess(
    "/bin/sh",
    [fileURLToPath(entrypointUrl), "--print-hba"],
    {
      ...process.env,
      POSTGRES_USER: "cluster_bootstrap",
      JOBS_CONNECTOR_DATABASE_USER: "jobs_connector"
    }
  );
  assert.equal(generated.code, 0, generated.stderr);

  const localFamilyReject = generated.stdout.search(
    /^local\s+all\s+\/\^\(platform\|seo\|jobs\|realtime\)_\(owner\|runtime\)\(_\[a-z0-9_\]\+\)\?\$\s+reject$/mu
  );
  const hostFamilyReject = generated.stdout.search(
    /^host\s+all\s+\/\^\(platform\|seo\|jobs\|realtime\)_\(owner\|runtime\)\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  const localGeneral = generated.stdout.search(/^local\s+all\s+all\s+trust$/mu);
  const hostGeneral = generated.stdout.search(
    /^host\s+all\s+all\s+all\s+scram-sha-256$/mu
  );
  assert.ok(localFamilyReject >= 0);
  assert.ok(hostFamilyReject >= 0);
  assert.ok(localGeneral > localFamilyReject);
  assert.ok(hostGeneral > hostFamilyReject);

  for (const mapping of mappings) {
    const localAllow = generated.stdout.search(
      new RegExp(
        `^local\\s+${mapping.database}\\s+"${mapping.owner}"\\s+scram-sha-256$`,
        "mu"
      )
    );
    const localRuntimeAllow = generated.stdout.search(
      new RegExp(
        `^local\\s+${mapping.database}\\s+"${mapping.runtime}"\\s+scram-sha-256$`,
        "mu"
      )
    );
    const hostAllow = generated.stdout.search(
      new RegExp(
        `^host\\s+${mapping.database}\\s+"${mapping.owner}"\\s+all\\s+scram-sha-256$`,
        "mu"
      )
    );
    const hostRuntimeAllow = generated.stdout.search(
      new RegExp(
        `^host\\s+${mapping.database}\\s+"${mapping.runtime}"\\s+all\\s+scram-sha-256$`,
        "mu"
      )
    );
    assert.ok(localAllow >= 0 && localAllow < localFamilyReject);
    assert.ok(localRuntimeAllow >= 0 && localRuntimeAllow < localFamilyReject);
    assert.ok(hostAllow >= 0 && hostAllow < hostFamilyReject);
    assert.ok(hostRuntimeAllow >= 0 && hostRuntimeAllow < hostFamilyReject);
  }

  const directusAllow = generated.stdout.search(
    /^host\s+directus_db\s+"directus_runtime_owner"\s+all\s+scram-sha-256$/mu
  );
  const directusReject = generated.stdout.search(
    /^host\s+all\s+\/\^directus_runtime_owner\(_\[a-z0-9_\]\+\)\?\$\s+all\s+reject$/mu
  );
  assert.ok(directusAllow >= 0);
  assert.ok(directusReject > directusAllow);
  assert.ok(hostGeneral > directusReject);
  assert.doesNotMatch(generated.stdout, /^host\s+.+\s+trust$/mu);

  for (const forbiddenBootstrapRole of [
    "platform_owner",
    "seo_runtime",
    "jobs_owner",
    "realtime_runtime",
    "directus_runtime_owner"
  ]) {
    const invalid = await runProcess(
      "/bin/sh",
      [fileURLToPath(entrypointUrl), "--print-hba"],
      {
        ...process.env,
        POSTGRES_USER: forbiddenBootstrapRole,
        JOBS_CONNECTOR_DATABASE_USER: "jobs_connector"
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
