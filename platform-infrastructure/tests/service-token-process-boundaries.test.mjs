import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
const rootEnvUrl = new URL("../../.env.example", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);

const globallyDistinctDeployCredentials = [
  "PLATFORM_API_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_JOBS_TOKEN",
  "JOBS_TO_SEO_DATA_TOKEN",
  "PLATFORM_API_TO_REALTIME_TOKEN",
  "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
  "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN",
  "JOBS_TO_SEO_RANK_TOKEN",
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
  "JOBS_TO_SEO_RANK_RESULT_TOKEN",
  "RANK_HISTORY_CURSOR_KEY"
];

const tokenBearingServices = [
  "platform-api",
  "seo-data",
  "jobs-integrations",
  "import-worker",
  "rank-worker",
  "realtime"
];

const callerAudienceBoundaries = new Map([
  [
    "PLATFORM_API_TO_SEO_DATA_TOKEN",
    ["platform-api", "seo-data"]
  ],
  [
    "PLATFORM_API_TO_JOBS_TOKEN",
    ["jobs-integrations", "platform-api"]
  ],
  [
    "JOBS_TO_SEO_DATA_TOKEN",
    ["import-worker", "jobs-integrations", "seo-data"]
  ],
  [
    "PLATFORM_API_TO_REALTIME_TOKEN",
    ["platform-api", "realtime"]
  ]
]);

const dedicatedBoundaries = new Map([
  [
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
    ["jobs-integrations", "platform-api"]
  ],
  [
    "PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN",
    ["platform-api", "realtime"]
  ],
  [
    "JOBS_TO_SEO_RANK_TOKEN",
    ["rank-worker", "seo-data"]
  ],
  [
    "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
    ["platform-api", "rank-worker"]
  ]
]);

const jobsRuntimeEnvironment = [
  "DATABASE_POOL_MAX",
  "DATABASE_URL",
  "NODE_ENV",
  "REDIS_URL",
  "SERVICE_VERSION"
];

const s3Environment = [
  "S3_ACCESS_KEY_ID",
  "S3_BUCKET_ARTIFACTS",
  "S3_BUCKET_UPLOADS",
  "S3_ENABLED",
  "S3_ENDPOINT",
  "S3_FORCE_PATH_STYLE",
  "S3_REGION",
  "S3_SECRET_ACCESS_KEY",
  "S3_SIGNED_URL_TTL_SECONDS"
];

const expectedJobsHttpEnvironment = sorted([
  ...jobsRuntimeEnvironment,
  ...s3Environment,
  "EMAIL_ENABLED",
  "EMAIL_FROM",
  "INTEGRATION_CREDENTIAL_ACTIVE_FINGERPRINT_KEY_VERSION",
  "INTEGRATION_CREDENTIAL_ACTIVE_KEY_VERSION",
  "INTEGRATION_CREDENTIAL_FINGERPRINT_KEYS",
  "INTEGRATION_CREDENTIAL_KEYS",
  "INTEGRATION_CREDENTIAL_ROLE",
  "JOBS_TO_SEO_DATA_TOKEN",
  "NATS_PASSWORD",
  "NATS_URL",
  "NATS_USER",
  "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
  "PLATFORM_API_TO_JOBS_TOKEN",
  "PORT",
  "SEO_DATA_COMMAND_TIMEOUT_MS",
  "SEO_DATA_URL",
  "SMTP_HOST",
  "SMTP_PASSWORD",
  "SMTP_PORT",
  "SMTP_SECURE",
  "SMTP_USER",
  "UPLOAD_EXPIRES_HOURS",
  "UPLOAD_MAX_SIZE_BYTES",
  "UPLOAD_PART_SIZE_BYTES"
]);

const expectedSystemWorkerEnvironment = sorted([
  "NODE_ENV",
  "REDIS_URL",
  "SERVICE_VERSION",
  "SYSTEM_WORKER_CONCURRENCY"
]);

const expectedImportWorkerEnvironment = sorted([
  ...jobsRuntimeEnvironment,
  ...s3Environment,
  "IMPORT_PARSE_CONCURRENCY",
  "IMPORT_PARSE_DISPATCH_SECONDS",
  "IMPORT_PARSE_HEARTBEAT_SECONDS",
  "IMPORT_PARSE_LEASE_MINUTES",
  "IMPORT_PREVIEW_ROWS",
  "IMPORT_PUBLISH_BATCH_ROWS",
  "IMPORT_STAGING_BATCH_ROWS",
  "JOBS_TO_SEO_DATA_TOKEN",
  "SEO_DATA_COMMAND_TIMEOUT_MS",
  "SEO_DATA_URL"
]);

const expectedInspectionWorkerEnvironment = sorted([
  ...jobsRuntimeEnvironment,
  ...s3Environment,
  "MALWARE_SCANNER_CONNECT_TIMEOUT_MS",
  "MALWARE_SCANNER_ENABLED",
  "MALWARE_SCANNER_HOST",
  "MALWARE_SCANNER_PORT",
  "MALWARE_SCANNER_SCAN_TIMEOUT_MS",
  "UPLOAD_INSPECTION_CONCURRENCY",
  "UPLOAD_INSPECTION_DISPATCH_SECONDS",
  "UPLOAD_INSPECTION_HEARTBEAT_SECONDS",
  "UPLOAD_INSPECTION_LEASE_MINUTES"
]);

test("production inputs retire the shared internal token", async () => {
  const [compose, rootEnv] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(rootEnvUrl, "utf8")
  ]);

  assert.equal(
    /\bINTERNAL_API_TOKEN\b/u.test(compose),
    false,
    "Compose must not expose the retired shared credential"
  );
  assert.equal(
    /^INTERNAL_API_TOKEN=/mu.test(rootEnv),
    false,
    "the root deploy example must not document the retired shared credential"
  );
});

test("caller/audience tokens are operator-generated and reach only exact peers", async () => {
  const [compose, rootEnv] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(rootEnvUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);
  const envExample = parseEnvExample(rootEnv);

  for (const [token, expectedServices] of callerAudienceBoundaries) {
    assert.deepEqual(
      envExample.get(token),
      [""],
      `${token} must be documented once without reusable secret material`
    );
    assertTokenBoundary(document, token, expectedServices);
  }
});

test("example Compose validation supplies distinct CI-only caller tokens", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const command = packageJson.scripts?.["infra:validate:example"];
  assert.equal(typeof command, "string");
  const assignments = new Map(
    command
      .split(" docker compose", 1)[0]
      .split(" ")
      .map((entry) => entry.split("=", 2))
  );
  const values = [];

  for (const token of callerAudienceBoundaries.keys()) {
    const value = assignments.get(token);
    assert.equal(
      typeof value,
      "string",
      `${token} must be supplied only for Compose rendering`
    );
    assert.ok(value.length >= 32, `${token} CI value must remain nontrivial`);
    values.push(value);
  }
  assert.equal(new Set(values).size, values.length);
});

test("dedicated credential, notification and rank tokens keep narrow scopes", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);

  for (const [token, expectedServices] of dedicatedBoundaries) {
    assertTokenBoundary(document, token, expectedServices);
  }
});

test("isolated deploy preflight receives only all globally distinct credentials", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const preflight = serviceMapping(document, "service-token-preflight");
  const environment = serviceEnvironment(
    document,
    "service-token-preflight"
  );

  assert.deepEqual(
    sorted(environment.keys()),
    sorted(globallyDistinctDeployCredentials)
  );
  for (const token of globallyDistinctDeployCredentials) {
    assertRequiredSelfInterpolation(
      environment.get(token),
      token,
      "service-token-preflight"
    );
  }

  const resolved = resolveMapping(preflight, document);
  assert.equal(resolved.get("image"), "postgres:18.3-alpine3.23");
  assert.equal(stripMatchingQuotes(resolved.get("restart")), "no");
  assert.equal(resolved.get("init"), "true");
  assert.equal(stripMatchingQuotes(resolved.get("user")), "65534:65534");
  assert.equal(stripMatchingQuotes(resolved.get("network_mode")), "none");
  assert.equal(resolved.get("read_only"), "true");
  assert.equal(
    resolved.get("entrypoint"),
    '["/bin/sh", "/security/validate-service-tokens.sh"]'
  );
  assert.equal(resolved.get("cap_drop"), '["ALL"]');
  assert.equal(
    resolved.get("security_opt"),
    '["no-new-privileges:true"]'
  );
  assert.equal(resolved.has("networks"), false);
});

test("every token-bearing runtime waits for successful deploy preflight", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);

  for (const serviceName of tokenBearingServices) {
    const service = resolveMapping(
      serviceMapping(document, serviceName),
      document
    );
    const dependencies = service.get("depends_on");
    assert.ok(
      isMapping(dependencies),
      `${serviceName} must declare dependencies`
    );
    const preflight = resolveMapping(dependencies, document).get(
      "service-token-preflight"
    );
    assert.ok(
      isMapping(preflight),
      `${serviceName} must depend on service-token-preflight`
    );
    assert.equal(
      resolveMapping(preflight, document).get("condition"),
      "service_completed_successfully"
    );
  }
});

test("Jobs HTTP receives only its declared application capabilities", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const environment = serviceEnvironment(document, "jobs-integrations");

  assert.deepEqual(
    sorted(environment.keys()),
    expectedJobsHttpEnvironment
  );
});

test("generic Jobs worker is a Redis-only process", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const environment = serviceEnvironment(document, "system-worker");

  assert.deepEqual(
    sorted(environment.keys()),
    expectedSystemWorkerEnvironment
  );
});

test("import worker receives only DB, Redis, S3 and SEO publication capabilities", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const environment = serviceEnvironment(document, "import-worker");

  assert.deepEqual(
    sorted(environment.keys()),
    expectedImportWorkerEnvironment
  );
});

test("inspection worker receives only DB, Redis, S3 and malware capabilities", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const environment = serviceEnvironment(
    document,
    "upload-inspection-worker"
  );

  assert.deepEqual(
    sorted(environment.keys()),
    expectedInspectionWorkerEnvironment
  );
});

function assertTokenBoundary(document, token, expectedServices) {
  const actualServices = [];
  for (const serviceName of serviceNames(document)) {
    if (serviceName === "service-token-preflight") continue;
    const environment = serviceEnvironment(document, serviceName, false);
    if (!environment?.has(token)) continue;
    actualServices.push(serviceName);
    assertRequiredSelfInterpolation(
      environment.get(token),
      token,
      serviceName
    );
  }

  assert.deepEqual(
    sorted(actualServices),
    sorted(expectedServices),
    `${token} has an unexpected effective Compose audience`
  );
}

function assertRequiredSelfInterpolation(value, token, serviceName) {
  assert.equal(
    typeof value,
    "string",
    `${serviceName} must assign ${token} from a required deploy variable`
  );
  const unquoted = stripMatchingQuotes(value);
  const interpolation = /^\$\{([A-Z][A-Z0-9_]*):\?[^}]+\}$/u.exec(unquoted);
  assert.ok(
    interpolation,
    `${serviceName} must require ${token} instead of embedding a value`
  );
  assert.equal(
    interpolation[1],
    token,
    `${serviceName} must not reuse another service credential for ${token}`
  );
}

function serviceNames(document) {
  const services = mappingValue(
    resolveMapping(document.root, document),
    "services",
    "Compose services"
  );
  return [...resolveMapping(services, document).keys()];
}

function serviceEnvironment(document, serviceName, required = true) {
  const service = serviceMapping(document, serviceName);
  const environment = resolveMapping(service, document).get("environment");
  if (!isMapping(environment)) {
    if (!required) return undefined;
    assert.fail(`${serviceName} must have an environment mapping`);
  }
  return resolveMapping(environment, document);
}

function serviceMapping(document, serviceName) {
  const services = mappingValue(
    resolveMapping(document.root, document),
    "services",
    "Compose services"
  );
  const service = resolveMapping(services, document).get(serviceName);
  assert.ok(isMapping(service), `${serviceName} service must exist`);
  return service;
}

function parseEnvExample(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    const entries = values.get(match[1]) ?? [];
    entries.push(match[2]);
    values.set(match[1], entries);
  }
  return values;
}

function parseYamlMappings(source) {
  const root = createMapping();
  const document = { anchors: new Map(), root };
  const stack = [{ indent: -1, mapping: root }];

  for (const [lineIndex, rawLine] of source.split(/\r?\n/u).entries()) {
    if (rawLine.trim() === "" || rawLine.trimStart().startsWith("#")) {
      continue;
    }
    assert.doesNotMatch(
      rawLine,
      /^\t+/u,
      `Compose line ${lineIndex + 1} must not use tab indentation`
    );
    const indent = rawLine.length - rawLine.trimStart().length;
    const content = rawLine.trim();

    while (stack.at(-1).indent >= indent) stack.pop();
    const parent = stack.at(-1)?.mapping;
    assert.ok(parent, `invalid Compose indentation at line ${lineIndex + 1}`);

    const listEnvironment = /^-\s+([A-Z][A-Z0-9_]*)(?:=(.*))?$/u.exec(
      content
    );
    if (listEnvironment) {
      addEntry(
        parent,
        listEnvironment[1],
        listEnvironment[2] ?? "",
        lineIndex
      );
      continue;
    }
    if (content.startsWith("-") || content === "[" || content === "]") {
      continue;
    }

    const property = /^(<<|[A-Za-z0-9_.-]+):(?:\s*(.*))?$/u.exec(content);
    if (!property) continue;
    const [, key, rawValue = ""] = property;

    if (key === "<<") {
      const aliases = [...rawValue.matchAll(/\*([A-Za-z0-9_-]+)/gu)].map(
        (match) => match[1]
      );
      assert.ok(
        aliases.length > 0,
        `unsupported YAML merge at Compose line ${lineIndex + 1}`
      );
      parent.merges.push(...aliases);
      continue;
    }

    const anchor = /^&([A-Za-z0-9_-]+)\s*$/u.exec(rawValue)?.[1];
    if (rawValue === "" || anchor) {
      const child = createMapping();
      addEntry(parent, key, child, lineIndex);
      if (anchor) {
        assert.ok(
          !document.anchors.has(anchor),
          `duplicate YAML anchor ${anchor}`
        );
        document.anchors.set(anchor, child);
      }
      stack.push({ indent, mapping: child });
      continue;
    }

    addEntry(parent, key, rawValue, lineIndex);
  }

  return document;
}

function resolveMapping(mapping, document, resolving = new Set()) {
  if (resolving.has(mapping)) {
    assert.fail("cyclic YAML merge is not supported");
  }
  resolving.add(mapping);
  const resolved = new Map();

  for (const alias of mapping.merges) {
    const inherited = document.anchors.get(alias);
    assert.ok(inherited, `unknown YAML anchor ${alias}`);
    for (const [key, value] of resolveMapping(
      inherited,
      document,
      resolving
    )) {
      if (!resolved.has(key)) resolved.set(key, value);
    }
  }
  for (const [key, value] of mapping.entries) resolved.set(key, value);

  resolving.delete(mapping);
  return resolved;
}

function mappingValue(mapping, key, description) {
  const value = mapping.get(key);
  assert.ok(isMapping(value), `${description} mapping must exist`);
  return value;
}

function createMapping() {
  return {
    entries: new Map(),
    merges: []
  };
}

function isMapping(value) {
  return (
    typeof value === "object" &&
    value !== null &&
    value.entries instanceof Map &&
    Array.isArray(value.merges)
  );
}

function addEntry(mapping, key, value, lineIndex) {
  assert.ok(
    !mapping.entries.has(key),
    `duplicate YAML key ${key} at Compose line ${lineIndex + 1}`
  );
  mapping.entries.set(key, value);
}

function stripMatchingQuotes(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function sorted(values) {
  return [...values].sort();
}
