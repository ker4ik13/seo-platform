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
const natsConfigUrl = new URL("../nats/nats-server.conf", import.meta.url);
const natsEntrypointUrl = new URL("../nats/start-nats.sh", import.meta.url);
const rootEnvUrl = new URL("../../.env.example", import.meta.url);
const packageUrl = new URL("../../package.json", import.meta.url);
const dockerfileUrl = new URL("../docker/backend.Dockerfile", import.meta.url);
const infrastructureDockerfileUrl = new URL(
  "../docker/infra.Dockerfile",
  import.meta.url
);

const natsCredentialMappings = new Map([
  [
    "backend-execution",
    [
      ["EXECUTION_HTTP_NATS_USER", "EXECUTION_HTTP_NATS_PASSWORD", "NATS_RUNTIME_USER", "NATS_RUNTIME_PASSWORD"],
      ["EXECUTION_AUTH_EMAIL_NATS_USER", "EXECUTION_AUTH_EMAIL_NATS_PASSWORD", "NATS_AUTH_EMAIL_CONSUMER_USER", "NATS_AUTH_EMAIL_CONSUMER_PASSWORD"]
    ]
  ],
  [
    "backend-core",
    [
      [
        "PLATFORM_NATS_USER",
        "PLATFORM_NATS_PASSWORD",
        "NATS_PLATFORM_PUBLISHER_USER",
        "NATS_PLATFORM_PUBLISHER_PASSWORD"
      ],
      [
        "SEO_NATS_USER",
        "SEO_NATS_PASSWORD",
        "NATS_RUNTIME_USER",
        "NATS_RUNTIME_PASSWORD"
      ],
      [
        "REALTIME_NATS_USER",
        "REALTIME_NATS_PASSWORD",
        "NATS_REALTIME_CONSUMER_USER",
        "NATS_REALTIME_CONSUMER_PASSWORD"
      ]
    ]
  ],
  [
    "nats-topology-provisioner",
    [["NATS_USER", "NATS_PASSWORD", "NATS_PROVISIONER_USER", "NATS_PROVISIONER_PASSWORD"]]
  ]
]);

const natsPasswordHashes = [
  "NATS_RUNTIME_PASSWORD_HASH",
  "NATS_PLATFORM_PUBLISHER_PASSWORD_HASH",
  "NATS_REALTIME_CONSUMER_PASSWORD_HASH",
  "NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH",
  "NATS_PROVISIONER_PASSWORD_HASH"
];

test("NATS server renders a private config inside a hardened container", async () => {
  const [compose, config, entrypoint, infrastructureDockerfile] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(natsConfigUrl, "utf8"),
    readFile(natsEntrypointUrl, "utf8"),
    readFile(infrastructureDockerfileUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);
  const nats = resolveMapping(serviceMapping(document, "nats"), document);
  const block = serviceBlock(compose, "nats");

  assert.equal(nats.get("build"), "*nats-runtime-build");
  assert.match(
    infrastructureDockerfile,
    /^FROM nats:2\.12\.12-alpine AS nats-runtime$/mu
  );
  assert.match(
    infrastructureDockerfile,
    /^COPY --chmod=0444 infrastructure\/nats\/nats-server\.conf \/etc\/nats\/nats-server\.conf$/mu
  );
  assert.equal(
    nats.get("entrypoint"),
    '["/bin/sh", "/etc/nats/start-nats.sh"]'
  );
  assert.equal(nats.has("command"), false);
  assert.equal(nats.get("read_only"), "true");
  assert.doesNotMatch(
    String(nats.get("entrypoint")),
    /--(?:user|pass|password|auth|token)/u
  );
  assert.doesNotMatch(block, /^\s+- \.\//mu);
  assert.match(block, /^\s{6}- \/run\/nats-runtime:rw,noexec,nosuid,size=1m,mode=0700$/mu);
  assert.match(block, /^\s{4}cap_drop:\s*\n\s{6}- ALL$/mu);
  assert.match(block, /^\s{6}- no-new-privileges:true$/mu);
  assert.doesNotMatch(block, /^\s{4}(?:ports|expose):/mu);
  assert.match(entrypoint, /^template=\$\{1:-\/etc\/nats\/nats-server\.conf\}$/mu);
  assert.match(entrypoint, /^runtime_directory=\$\{2:-\/run\/nats-runtime\}$/mu);
  assert.match(entrypoint, /^exec nats-server --config "\$runtime_config"$/mu);
  assert.match(config, /^max_payload:\s*64KB$/mu);
  assert.match(config, /^\s*max_mem_store:\s*64MB$/mu);
  assert.match(config, /^\s*max_file_store:\s*2GB$/mu);
  assert.match(config, /^\s*store_dir:\s*"\/data"$/mu);
  assert.equal(balanced(config, "{", "}"), true);
  assert.equal(balanced(config, "[", "]"), true);
  assert.doesNotMatch(config, /password:\s*\$NATS_(?:RUNTIME|PLATFORM_PUBLISHER|REALTIME_CONSUMER|AUTH_EMAIL_CONSUMER|PROVISIONER)_PASSWORD(?:\s|$)/u);
  for (const hashName of natsPasswordHashes) {
    assert.match(
      config,
      new RegExp(`password:\\s*"__${hashName}__"`, "u")
    );
  }
  assertDependency(document, "nats", "service-token-preflight");
});

test("NATS ACL grants exact runtime publisher consumer and provisioner subjects", async () => {
  const config = await readFile(natsConfigUrl, "utf8");
  const runtime = userBlock(config, "NATS_RUNTIME_USER");
  const publisher = userBlock(config, "NATS_PLATFORM_PUBLISHER_USER");
  const consumer = userBlock(config, "NATS_REALTIME_CONSUMER_USER");
  const authEmailConsumer = userBlock(config, "NATS_AUTH_EMAIL_CONSUMER_USER");
  const provisioner = userBlock(config, "NATS_PROVISIONER_USER");

  assert.deepEqual(permissionSubjects(runtime, "publish"), [">"]);
  assert.deepEqual(permissionSubjects(runtime, "subscribe"), [">"]);
  assert.match(runtime, /publish:\s*\{\s*deny:/u);
  assert.match(runtime, /subscribe:\s*\{\s*deny:/u);

  assert.deepEqual(permissionSubjects(publisher, "publish"), sorted([
    "$NATS_IDENTITY_EVENT_SUBJECT",
    "$NATS_EMAIL_VERIFICATION_EVENT_SUBJECT",
    "$NATS_PASSWORD_RESET_EVENT_SUBJECT",
    "$NATS_WORKSPACE_INVITE_EVENT_SUBJECT",
    "$NATS_NPD_RECEIPT_EVENT_SUBJECT",
    "$JS.API.INFO",
    "$JS.API.STREAM.INFO.IDENTITY_EVENTS",
    "$JS.API.STREAM.INFO.AUTH_EMAIL_EVENTS"
  ]));
  assert.deepEqual(permissionSubjects(publisher, "subscribe"), ["_INBOX.>"]);

  assert.deepEqual(permissionSubjects(consumer, "publish"), sorted([
    "$JS.API.INFO",
    "$JS.API.STREAM.INFO.IDENTITY_EVENTS",
    "$JS.API.STREAM.INFO.DOMAIN_EVENTS_DLQ",
    "$JS.API.CONSUMER.INFO.IDENTITY_EVENTS.realtime_session_family_revoked_v1",
    "$JS.API.CONSUMER.MSG.NEXT.IDENTITY_EVENTS.realtime_session_family_revoked_v1",
    "$JS.ACK.IDENTITY_EVENTS.realtime_session_family_revoked_v1.>",
    "$NATS_IDENTITY_EVENT_DLQ_SUBJECT"
  ]));
  assert.deepEqual(permissionSubjects(consumer, "subscribe"), ["_INBOX.>"]);

  assert.deepEqual(permissionSubjects(authEmailConsumer, "publish"), sorted([
    "$JS.API.INFO",
    "$JS.API.STREAM.INFO.AUTH_EMAIL_EVENTS",
    "$JS.API.STREAM.INFO.DOMAIN_EVENTS_DLQ",
    "$JS.API.CONSUMER.INFO.AUTH_EMAIL_EVENTS.jobs_auth_email_v1",
    "$JS.API.CONSUMER.MSG.NEXT.AUTH_EMAIL_EVENTS.jobs_auth_email_v1",
    "$JS.ACK.AUTH_EMAIL_EVENTS.jobs_auth_email_v1.>",
    "$NATS_AUTH_EMAIL_DLQ_SUBJECT"
  ]));
  assert.deepEqual(permissionSubjects(authEmailConsumer, "subscribe"), [
    "_INBOX.>"
  ]);

  assert.deepEqual(permissionSubjects(provisioner, "publish"), sorted([
    "$JS.API.INFO",
    "$JS.API.STREAM.INFO.IDENTITY_EVENTS",
    "$JS.API.STREAM.CREATE.IDENTITY_EVENTS",
    "$JS.API.STREAM.UPDATE.IDENTITY_EVENTS",
    "$JS.API.STREAM.INFO.AUTH_EMAIL_EVENTS",
    "$JS.API.STREAM.CREATE.AUTH_EMAIL_EVENTS",
    "$JS.API.STREAM.UPDATE.AUTH_EMAIL_EVENTS",
    "$JS.API.STREAM.INFO.DOMAIN_EVENTS_DLQ",
    "$JS.API.STREAM.CREATE.DOMAIN_EVENTS_DLQ",
    "$JS.API.STREAM.UPDATE.DOMAIN_EVENTS_DLQ",
    "$JS.API.CONSUMER.INFO.IDENTITY_EVENTS.realtime_session_family_revoked_v1",
    "$JS.API.CONSUMER.CREATE.IDENTITY_EVENTS.realtime_session_family_revoked_v1.>",
    "$JS.API.CONSUMER.INFO.AUTH_EMAIL_EVENTS.jobs_auth_email_v1",
    "$JS.API.CONSUMER.CREATE.AUTH_EMAIL_EVENTS.jobs_auth_email_v1.>"
  ]));
  assert.deepEqual(permissionSubjects(provisioner, "subscribe"), ["_INBOX.>"]);

  for (const block of [publisher, consumer, authEmailConsumer]) {
    assert.doesNotMatch(block, /\.CREATE\.|\.UPDATE\.|\.DELETE\./u);
  }
  assert.doesNotMatch(provisioner, /\.DELETE\.|\.PURGE\.|\.MSG\.GET\./u);
  assert.match(config, /default_permissions:\s*\{/u);
});

test("Compose maps each NATS identity only to its exact runtime audience", async () => {
  const [compose, rootEnv] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(rootEnvUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);
  const actualRecipients = [];

  for (const serviceName of serviceNames(document)) {
    const serviceEnv = serviceEnvironment(document, serviceName, false);
    if (!serviceEnv) continue;
    const expected = natsCredentialMappings.get(serviceName);
    const identityKeys = [...serviceEnv.keys()].filter((key) =>
      key.endsWith("NATS_USER")
    );
    if (!identityKeys.length) continue;
    actualRecipients.push(serviceName);
    assert.ok(expected, `${serviceName} must not receive an NATS identity`);
    assert.equal(identityKeys.length, expected.length);
    for (const [userKey, passwordKey, userInput, passwordInput] of expected) {
      assertInterpolation(serviceEnv.get(userKey), userInput);
      assertInterpolation(serviceEnv.get(passwordKey), passwordInput);
    }
  }
  assert.deepEqual(sorted(actualRecipients), sorted(natsCredentialMappings.keys()));

  assert.doesNotMatch(rootEnv, /^NATS_USER=/mu);
  assert.doesNotMatch(rootEnv, /^NATS_PASSWORD=/mu);
  assert.doesNotMatch(compose, /\$\{NATS_(?:USER|PASSWORD)(?::|\})/u);

  const natsEnvironment = serviceEnvironment(document, "nats");
  assert.deepEqual(sorted(natsEnvironment.keys()), sorted([
    "NATS_RUNTIME_USER",
    "NATS_RUNTIME_PASSWORD_HASH",
    "NATS_PLATFORM_PUBLISHER_USER",
    "NATS_PLATFORM_PUBLISHER_PASSWORD_HASH",
    "NATS_REALTIME_CONSUMER_USER",
    "NATS_REALTIME_CONSUMER_PASSWORD_HASH",
    "NATS_AUTH_EMAIL_CONSUMER_USER",
    "NATS_AUTH_EMAIL_CONSUMER_PASSWORD_HASH",
    "NATS_PROVISIONER_USER",
    "NATS_PROVISIONER_PASSWORD_HASH",
    "NATS_IDENTITY_EVENT_SUBJECT",
    "NATS_IDENTITY_EVENT_DLQ_SUBJECT",
    "NATS_EMAIL_VERIFICATION_EVENT_SUBJECT",
    "NATS_PASSWORD_RESET_EVENT_SUBJECT",
    "NATS_WORKSPACE_INVITE_EVENT_SUBJECT",
    "NATS_NPD_RECEIPT_EVENT_SUBJECT",
    "NATS_AUTH_EMAIL_DLQ_SUBJECT"
  ]));
  for (const passwordName of [
    "NATS_RUNTIME_PASSWORD",
    "NATS_PLATFORM_PUBLISHER_PASSWORD",
    "NATS_REALTIME_CONSUMER_PASSWORD",
    "NATS_AUTH_EMAIL_CONSUMER_PASSWORD",
    "NATS_PROVISIONER_PASSWORD"
  ]) {
    assert.equal(natsEnvironment.has(passwordName), false);
  }
});

test("publisher and consumer receive canonical topology and wait for provisioner", async () => {
  const compose = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(compose);
  const platformApi = serviceEnvironment(document, "backend-core");
  const realtime = platformApi;

  assert.equal(stripMatchingQuotes(platformApi.get("OUTBOX_PUBLISHER_ENABLED")), "true");
  assert.equal(platformApi.get("NATS_EVENT_STREAM"), "IDENTITY_EVENTS");
  assert.equal(platformApi.get("NATS_AUTH_EMAIL_STREAM"), "AUTH_EMAIL_EVENTS");
  assertInterpolation(platformApi.get("NATS_EVENT_ENVIRONMENT"), "NATS_EVENT_ENVIRONMENT");

  assert.equal(stripMatchingQuotes(realtime.get("NATS_EVENT_CONSUMER_ENABLED")), "true");
  assert.equal(realtime.get("NATS_EVENT_STREAM"), "IDENTITY_EVENTS");
  assert.equal(
    realtime.get("NATS_EVENT_CONSUMER_DURABLE"),
    "realtime_session_family_revoked_v1"
  );
  assert.equal(realtime.get("NATS_EVENT_DLQ_STREAM"), "DOMAIN_EVENTS_DLQ");
  assert.equal(realtime.get("NATS_EVENT_MAX_PAYLOAD_BYTES"), "${NATS_EVENT_MAX_PAYLOAD_BYTES:-65536}");
  assert.equal(
    realtime.get("NATS_EVENT_SHUTDOWN_GRACE_MS"),
    "${NATS_EVENT_SHUTDOWN_GRACE_MS:-10000}"
  );

  const authEmailWorker = serviceEnvironment(document, "backend-execution");
  assertInterpolation(
    authEmailWorker.get("AUTH_EMAIL_EVENT_ENVIRONMENT"),
    "NATS_EVENT_ENVIRONMENT"
  );

  for (const serviceName of ["backend-core", "backend-execution"]) {
    assertDependency(document, serviceName, "service-token-preflight");
    assertDependency(document, serviceName, "nats", "service_healthy");
    assertDependency(document, serviceName, "nats-topology-provisioner");
  }
});

test("topology provisioner is one-shot, least-capability and internal-only", async () => {
  const [compose, dockerfile] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(dockerfileUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);
  const service = resolveMapping(
    serviceMapping(document, "nats-topology-provisioner"),
    document
  );
  const environment = serviceEnvironment(document, "nats-topology-provisioner");
  const block = serviceBlock(compose, "nats-topology-provisioner");

  assert.deepEqual(sorted(environment.keys()), sorted([
    "NATS_URL",
    "NATS_USER",
    "NATS_PASSWORD",
    "NATS_EVENT_ENVIRONMENT"
  ]));
  assert.equal(stripMatchingQuotes(service.get("restart")), "no");
  assert.equal(service.get("init"), "true");
  assert.equal(stripMatchingQuotes(service.get("user")), "1000:1000");
  assert.equal(service.get("read_only"), "true");
  assert.equal(service.get("cap_drop"), '["ALL"]');
  assert.equal(service.get("security_opt"), '["no-new-privileges:true"]');
  assert.match(block, /^\s{6}- internal$/mu);
  assert.doesNotMatch(block, /^\s{6}- (?:outbound|edge)$/mu);
  assert.doesNotMatch(block, /^\s{4}(?:ports|expose):/mu);
  assert.doesNotMatch(block, /(?:TOKEN|DATABASE_URL|REDIS_URL|S3_|SMTP_|AUTH_):/u);
  assertDependency(document, "nats-topology-provisioner", "service-token-preflight");
  assertDependency(document, "nats-topology-provisioner", "nats", "service_healthy");

  assert.match(dockerfile, /^FROM runtime AS nats-provisioner$/mu);
  assert.match(dockerfile, /provisioner-config\.mjs/u);
  assert.match(dockerfile, /CMD \["node", "\/app\/nats\/provisioner\.mjs"\]/u);
});

test("example validation supplies distinct generated NATS inputs", async () => {
  const packageJson = JSON.parse(await readFile(packageUrl, "utf8"));
  const command = packageJson.scripts?.["infra:validate:example"];
  assert.equal(typeof command, "string");
  const assignments = new Map(
    command
      .split(" docker compose", 1)[0]
      .split(" ")
      .map((entry) => entry.split("=", 2))
  );
  const names = [
    "NATS_RUNTIME_USER",
    "NATS_PLATFORM_PUBLISHER_USER",
    "NATS_REALTIME_CONSUMER_USER",
    "NATS_AUTH_EMAIL_CONSUMER_USER",
    "NATS_PROVISIONER_USER"
  ];
  const passwords = [
    "NATS_RUNTIME_PASSWORD",
    "NATS_PLATFORM_PUBLISHER_PASSWORD",
    "NATS_REALTIME_CONSUMER_PASSWORD",
    "NATS_AUTH_EMAIL_CONSUMER_PASSWORD",
    "NATS_PROVISIONER_PASSWORD"
  ];
  assert.equal(new Set(names.map((name) => assignments.get(name))).size, 5);
  const passwordValues = passwords.map((name) => assignments.get(name));
  for (const value of passwordValues) {
    assert.equal(typeof value, "string");
    assert.ok(value.length >= 32);
    assert.match(value, /^[A-Za-z][-A-Za-z0-9._~]+$/u);
  }
  assert.equal(new Set(passwordValues).size, 5);
  const hashValues = natsPasswordHashes.map((name) => {
    const value = assignments.get(name);
    assert.equal(typeof value, "string");
    const unquoted = stripMatchingQuotes(value);
    assert.match(
      unquoted,
      /^\$2a\$11\$[./A-Za-z0-9]{53}$/u
    );
    return unquoted;
  });
  assert.equal(new Set(hashValues).size, 5);
  assert.equal(assignments.get("NATS_EVENT_ENVIRONMENT"), "ci");
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

function assertInterpolation(value, variable) {
  assert.equal(typeof value, "string");
  assert.match(
    stripMatchingQuotes(value),
    new RegExp(`^\\$\\{${variable}:\\?[^}]+\\}$`, "u")
  );
}

function permissionSubjects(user, permission) {
  const block = blockAfter(user, `${permission}:`);
  const subjects = [];
  const pattern = /"([^"]+)"|(\$NATS_[A-Z_]+)/gu;
  for (const match of block.matchAll(pattern)) {
    const subject = match[1] ?? match[2];
    const marker = /^__([A-Z][A-Z0-9_]*)__$/u.exec(subject);
    subjects.push(marker ? `$${marker[1]}` : subject);
  }
  return sorted(subjects);
}

function userBlock(config, userVariable) {
  return enclosingBlock(config, `user: "__${userVariable}__"`);
}

function blockAfter(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} must exist`);
  const start = source.indexOf("{", markerIndex + marker.length);
  assert.notEqual(start, -1, `${marker} block must open`);
  return balancedSlice(source, start);
}

function enclosingBlock(source, marker) {
  const markerIndex = source.indexOf(marker);
  assert.notEqual(markerIndex, -1, `${marker} must exist`);
  let depth = 0;
  for (let index = markerIndex - 1; index >= 0; index -= 1) {
    if (source[index] === "}") depth += 1;
    if (source[index] !== "{") continue;
    if (depth === 0) return balancedSlice(source, index);
    depth -= 1;
  }
  assert.fail(`${marker} enclosing block must exist`);
}

function balancedSlice(source, start) {
  let depth = 0;
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === "{") depth += 1;
    if (source[index] !== "}") continue;
    depth -= 1;
    if (depth === 0) return source.slice(start, index + 1);
  }
  assert.fail("configuration block must be balanced");
}

function balanced(source, open, close) {
  let depth = 0;
  for (const character of source) {
    if (character === open) depth += 1;
    if (character === close) depth -= 1;
    if (depth < 0) return false;
  }
  return depth === 0;
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
