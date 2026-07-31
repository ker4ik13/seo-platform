import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  isMapping,
  parseYamlMappings,
  resolveMapping,
  serviceEnvironment,
  serviceMapping,
  serviceNames,
  sorted,
  stripMatchingQuotes
} from "./helpers/compose-mappings.mjs";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
const envUrl = new URL("../../.env.example", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);
const jobsConfigUrl = new URL("../redis/jobs.conf", import.meta.url);
const realtimeConfigUrl = new URL("../redis/realtime.conf", import.meta.url);
const directusConfigUrl = new URL("../redis/directus.conf", import.meta.url);
const startUrl = new URL("../redis/start-redis.sh", import.meta.url);

const redisCredentials = new Map([
  [
    "REDIS_JOBS_API_PASSWORD",
    ["jobs-integrations", "redis-jobs", "service-token-preflight"]
  ],
  [
    "REDIS_JOBS_SYSTEM_PASSWORD",
    ["redis-jobs", "service-token-preflight", "system-worker"]
  ],
  [
    "REDIS_JOBS_INSPECTION_PASSWORD",
    ["redis-jobs", "service-token-preflight", "upload-inspection-worker"]
  ],
  [
    "REDIS_JOBS_IMPORT_PASSWORD",
    ["import-worker", "redis-jobs", "service-token-preflight"]
  ],
  [
    "REDIS_JOBS_RANK_PASSWORD",
    ["rank-worker", "redis-jobs", "service-token-preflight"]
  ],
  [
    "REDIS_JOBS_CRAWL_PASSWORD",
    ["crawl-worker", "redis-jobs", "service-token-preflight"]
  ],
  [
    "REDIS_JOBS_CONNECTOR_PASSWORD",
    ["connector-worker", "redis-jobs", "service-token-preflight"]
  ],
  [
    "REDIS_REALTIME_PASSWORD",
    ["realtime", "redis-realtime", "service-token-preflight"]
  ],
  [
    "REDIS_DIRECTUS_PASSWORD",
    ["directus", "redis-directus", "service-token-preflight"]
  ]
]);

const clientRoutes = [
  [
    "jobs-integrations",
    "REDIS_URL",
    "redis://seo_jobs_api:${REDIS_JOBS_API_PASSWORD:?REDIS_JOBS_API_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "system-worker",
    "REDIS_URL",
    "redis://seo_jobs_system:${REDIS_JOBS_SYSTEM_PASSWORD:?REDIS_JOBS_SYSTEM_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "upload-inspection-worker",
    "REDIS_URL",
    "redis://seo_jobs_inspection:${REDIS_JOBS_INSPECTION_PASSWORD:?REDIS_JOBS_INSPECTION_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "import-worker",
    "REDIS_URL",
    "redis://seo_jobs_import:${REDIS_JOBS_IMPORT_PASSWORD:?REDIS_JOBS_IMPORT_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "rank-worker",
    "REDIS_URL",
    "redis://seo_jobs_rank:${REDIS_JOBS_RANK_PASSWORD:?REDIS_JOBS_RANK_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "crawl-worker",
    "REDIS_URL",
    "redis://seo_jobs_crawl:${REDIS_JOBS_CRAWL_PASSWORD:?REDIS_JOBS_CRAWL_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "connector-worker",
    "REDIS_URL",
    "redis://seo_jobs_connector:${REDIS_JOBS_CONNECTOR_PASSWORD:?REDIS_JOBS_CONNECTOR_PASSWORD is required}@redis-jobs:6379",
    "redis-jobs",
    "jobs-redis"
  ],
  [
    "realtime",
    "REDIS_URL",
    "redis://seo_realtime:${REDIS_REALTIME_PASSWORD:?REDIS_REALTIME_PASSWORD is required}@redis-realtime:6379",
    "redis-realtime",
    "realtime-redis"
  ],
  [
    "directus",
    "REDIS",
    "redis://seo_directus:${REDIS_DIRECTUS_PASSWORD:?REDIS_DIRECTUS_PASSWORD is required}@redis-directus:6379",
    "redis-directus",
    "directus-redis"
  ]
];

test("Compose gives every Redis credential only to its exact server and client", async () => {
  const [compose, env] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(envUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);
  const envExample = parseEnvExample(env);

  assert.doesNotMatch(compose, /\bREDIS_PASSWORD\b/u);
  assert.doesNotMatch(env, /^REDIS_PASSWORD=/mu);
  assert.equal(envExample.has("REDIS_PASSWORD"), false);

  for (const [credential, expectedRecipients] of redisCredentials) {
    assert.deepEqual(envExample.get(credential), [""]);
    const actualRecipients = [];
    for (const serviceName of serviceNames(document)) {
      const environment = serviceEnvironment(document, serviceName, false);
      if (!environment) continue;
      if (
        [...environment.entries()].some(
          ([key, value]) =>
            key === credential ||
            String(value).includes(`\${${credential}:?`)
        )
      ) {
        actualRecipients.push(serviceName);
      }
    }
    assert.deepEqual(
      sorted(actualRecipients),
      sorted(expectedRecipients),
      `${credential} must not cross a Redis process boundary`
    );
  }
});

test("Redis instances are pinned, bounded, internal-only and secret-safe", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const defaults = topLevelBlock(compose, "x-redis-defaults");

  assert.match(defaults, /^  image: redis:8\.8\.1-alpine3\.23$/mu);
  assert.match(defaults, /^  read_only: true$/mu);
  assert.match(defaults, /"redis-cli",\n        "-e"/u);
  assert.match(defaults, /"seo_health"/u);
  assert.match(defaults, /"--pass",\n        "health"/u);
  assert.doesNotMatch(defaults, /\$\{|--requirepass|"-a"/u);

  const instances = new Map([
    [
      "redis-jobs",
      {
        command: '["/bin/sh", "/redis/start-redis.sh", "jobs"]',
        credentials: [...redisCredentials.keys()].filter((name) =>
          name.startsWith("REDIS_JOBS_")
        ),
        network: "jobs-redis"
      }
    ],
    [
      "redis-realtime",
      {
        command: '["/bin/sh", "/redis/start-redis.sh", "realtime"]',
        credentials: ["REDIS_REALTIME_PASSWORD"],
        network: "realtime-redis"
      }
    ],
    [
      "redis-directus",
      {
        command: '["/bin/sh", "/redis/start-redis.sh", "directus"]',
        credentials: ["REDIS_DIRECTUS_PASSWORD"],
        network: "directus-redis"
      }
    ]
  ]);

  for (const [serviceName, expected] of instances) {
    const service = resolveMapping(serviceMapping(document, serviceName), document);
    const environment = serviceEnvironment(document, serviceName);
    const block = serviceBlock(compose, serviceName);

    assert.equal(service.get("image"), "redis:8.8.1-alpine3.23");
    assert.equal(service.get("read_only"), "true");
    assert.equal(service.get("command"), expected.command);
    assert.deepEqual(sorted(environment.keys()), sorted(expected.credentials));
    assert.match(block, /^      - \.\/redis:\/redis:ro$/mu);
    assert.match(block, /^      - \/run\/redis-runtime:.*mode=0700$/mu);
    assert.match(block, new RegExp(`^      - ${expected.network}$`, "mu"));
    assert.doesNotMatch(block, /^      - (?:internal|edge|outbound)$/mu);
    assert.doesNotMatch(block, /^    (?:ports|expose):/mu);
    assert.doesNotMatch(block, /--requirepass|REDISCLI_AUTH/u);
    assert.match(block, /^    cpus: /mu);
    assert.match(block, /^    mem_limit: /mu);
    assert.match(block, /^    pids_limit: /mu);
    assertDependency(document, serviceName, "service-token-preflight");
  }

  assert.match(
    serviceBlock(compose, "redis-jobs"),
    /^      - redis_jobs_data:\/data$/mu
  );
  for (const serviceName of ["redis-realtime", "redis-directus"]) {
    assert.doesNotMatch(serviceBlock(compose, serviceName), /redis_jobs_data/u);
    assert.match(serviceBlock(compose, serviceName), /^      - \/data:.*size=16m/mu);
  }

  for (const network of ["jobs-redis", "realtime-redis", "directus-redis"]) {
    assert.match(
      compose,
      new RegExp(`^  ${network}:\\n    internal: true$`, "mu")
    );
  }
});

test("every runtime uses its canonical named user, host and isolated network", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);

  for (const [serviceName, envName, expectedUrl, dependency, network] of clientRoutes) {
    const environment = serviceEnvironment(document, serviceName);
    assert.equal(stripMatchingQuotes(environment.get(envName)), expectedUrl);
    assertDependency(document, serviceName, dependency, "service_healthy");
    const networks = nestedBlock(serviceBlock(compose, serviceName), "networks");
    assert.match(networks, new RegExp(`^      - ${network}$`, "mu"));
  }

  const directus = serviceEnvironment(document, "directus");
  assert.equal(stripMatchingQuotes(directus.get("CACHE_ENABLED")), "true");
  assert.equal(directus.get("CACHE_STORE"), "redis");
  assert.equal(directus.get("CACHE_NAMESPACE"), "seo-platform:directus:v1");
  assert.equal(stripMatchingQuotes(directus.get("CACHE_AUTO_PURGE")), "true");
  assert.doesNotMatch(String(directus.get("REDIS")), /\/1(?:\b|$)/u);
});

test("Redis policies separate durable queues, ephemeral realtime and CMS cache", async () => {
  const [compose, jobs, realtime, directus, start] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(jobsConfigUrl, "utf8"),
    readFile(realtimeConfigUrl, "utf8"),
    readFile(directusConfigUrl, "utf8"),
    readFile(startUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);

  for (const config of [jobs, realtime, directus]) {
    assert.match(config, /^protected-mode yes$/mu);
    assert.match(config, /^databases 1$/mu);
    assert.match(config, /^aclfile \/run\/redis-runtime\/users\.acl$/mu);
    assert.match(config, /^acl-pubsub-default resetchannels$/mu);
    assert.match(config, /^maxmemory [1-9][0-9]*mb$/mu);
    assert.doesNotMatch(config, /^requirepass\b/mu);
  }

  assert.match(jobs, /^appendonly yes$/mu);
  assert.match(jobs, /^appendfsync everysec$/mu);
  assert.match(jobs, /^maxmemory 256mb$/mu);
  assert.match(jobs, /^maxmemory-policy noeviction$/mu);
  assert.equal(
    resolveMapping(serviceMapping(document, "redis-jobs"), document).get(
      "mem_limit"
    ),
    "768M"
  );
  assert.match(realtime, /^appendonly no$/mu);
  assert.match(realtime, /^save ""$/mu);
  assert.match(realtime, /^maxmemory-policy volatile-ttl$/mu);
  assert.match(realtime, /^client-output-buffer-limit pubsub 32mb 8mb 60$/mu);
  assert.match(directus, /^appendonly no$/mu);
  assert.match(directus, /^save ""$/mu);
  assert.match(directus, /^maxmemory-policy allkeys-lru$/mu);

  const renderIndex = start.indexOf("render-acl.sh");
  const copyIndex = start.indexOf('cp "$script_dir/$instance.conf"');
  const unsetIndex = start.indexOf("unset \\");
  const execIndex = start.indexOf("exec /usr/local/bin/docker-entrypoint.sh");
  assert.ok(renderIndex >= 0);
  assert.ok(unsetIndex > renderIndex);
  assert.ok(copyIndex > unsetIndex);
  assert.ok(execIndex > unsetIndex);
  assert.match(start, /^runtime_directory=\/run\/redis-runtime$/mu);
  assert.match(start, /^chown redis:redis "\$runtime_directory"$/mu);
  assert.match(start, /^chmod 700 "\$runtime_directory"$/mu);
  assert.match(
    start,
    /^chown redis:redis "\$acl_file" "\$temporary_config"$/mu
  );
  assert.match(start, /^chmod 600 "\$acl_file" "\$temporary_config"$/mu);
  assert.match(start, /redis-server "\$runtime_config"$/mu);
  assert.doesNotMatch(start.slice(execIndex), /\$script_dir\/\$instance\.conf/u);
  assert.doesNotMatch(start.slice(execIndex), /REDIS_[A-Z_]+|--requirepass/u);
});

test("example Compose validation supplies nine distinct URL-safe Redis secrets", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const command = packageJson.scripts?.["infra:validate:example"];
  assert.equal(typeof command, "string");
  const assignments = new Map(
    command
      .split(" docker compose", 1)[0]
      .split(" ")
      .map((entry) => entry.split("=", 2))
  );
  const values = [...redisCredentials.keys()].map((name) => assignments.get(name));
  for (const value of values) {
    assert.equal(typeof value, "string");
    assert.match(value, /^[A-Za-z][A-Za-z0-9._~-]{31,511}$/u);
  }
  assert.equal(new Set(values).size, values.length);
});

function assertDependency(
  document,
  serviceName,
  dependencyName,
  condition = "service_completed_successfully"
) {
  const service = resolveMapping(serviceMapping(document, serviceName), document);
  const dependencies = service.get("depends_on");
  assert.ok(isMapping(dependencies), `${serviceName} must declare dependencies`);
  const dependency = resolveMapping(dependencies, document).get(dependencyName);
  assert.ok(isMapping(dependency), `${serviceName} must wait for ${dependencyName}`);
  assert.equal(resolveMapping(dependency, document).get("condition"), condition);
}

function parseEnvExample(source) {
  const values = new Map();
  for (const line of source.split(/\r?\n/u)) {
    const match = /^([A-Z][A-Z0-9_]*)=(.*)$/u.exec(line);
    if (!match) continue;
    const entries = values.get(match[1]) ?? [];
    entries.push(match[2]);
    values.set(match[1], entries);
  }
  return values;
}

function topLevelBlock(compose, name) {
  const lines = compose.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `${name}: &${name.slice(2)}`);
  assert.notEqual(start, -1, `${name} block must exist`);
  const end = lines.findIndex(
    (line, index) => index > start && /^[a-z][a-z0-9-]*:/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function serviceBlock(compose, serviceName) {
  const lines = compose.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `  ${serviceName}:`);
  assert.notEqual(start, -1, `${serviceName} service must exist`);
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^  [a-z0-9][a-z0-9-]*:\s*$/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}

function nestedBlock(service, key) {
  const lines = service.split(/\r?\n/u);
  const start = lines.findIndex((line) => line === `    ${key}:`);
  assert.notEqual(start, -1, `${key} block must exist`);
  const end = lines.findIndex(
    (line, index) =>
      index > start && /^    [a-z_][a-z0-9_-]*:/u.test(line)
  );
  return lines.slice(start, end === -1 ? undefined : end).join("\n");
}
