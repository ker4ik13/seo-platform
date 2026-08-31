import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseYamlMappings,
  resolveMapping,
  serviceEnvironment,
  serviceMapping,
  serviceNames,
  sorted
} from "./helpers/compose-mappings.mjs";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);

const containerBoundaries = new Map([
  ["PLATFORM_API_TO_SEO_DATA_TOKEN", ["backend-core"]],
  ["PLATFORM_API_TO_JOBS_TOKEN", ["backend-core", "backend-execution"]],
  ["JOBS_TO_SEO_DATA_TOKEN", ["backend-core", "backend-execution"]],
  ["PLATFORM_API_TO_REALTIME_TOKEN", ["backend-core"]],
  [
    "PLATFORM_API_TO_JOBS_CREDENTIAL_TOKEN",
    ["backend-core", "backend-execution"]
  ],
  ["PLATFORM_API_TO_REALTIME_NOTIFICATION_TOKEN", ["backend-core"]],
  ["REALTIME_TO_PLATFORM_NOTIFICATION_TOKEN", ["backend-core"]],
  ["JOBS_TO_SEO_RANK_TOKEN", ["backend-core", "backend-execution"]],
  [
    "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN",
    ["backend-core", "backend-execution"]
  ],
  [
    "JOBS_TO_PLATFORM_BILLING_SETTLEMENT_TOKEN",
    ["backend-core", "backend-execution"]
  ],
  [
    "JOBS_TO_PLATFORM_AUTOMATION_TOKEN",
    ["backend-core", "backend-execution"]
  ],
  [
    "JOBS_TO_SEO_RANK_RESULT_TOKEN",
    ["backend-core", "backend-execution"]
  ],
  [
    "JOBS_TO_PLATFORM_AUTH_EMAIL_TOKEN",
    ["backend-core", "backend-execution"]
  ],
  ["RANK_HISTORY_CURSOR_KEY", ["backend-core"]],
  [
    "OPERATIONAL_ALERT_TOKEN",
    ["backend-core", "backend-execution", "frontend"]
  ]
]);

test("service tokens reach only the two owning backend containers", async () => {
  const document = parseYamlMappings(await readFile(composeUrl, "utf8"));

  for (const [token, expectedServices] of containerBoundaries) {
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
      `${token} has an unexpected container audience`
    );
  }
});

test("backend supervisors retain child-process capability boundaries", async () => {
  const [coreRuntime, executionRuntime, supervisorTest] = await Promise.all([
    readFile(
      new URL("../../backend-core/src/runtime-processes.ts", import.meta.url),
      "utf8"
    ),
    readFile(
      new URL(
        "../../backend-execution/src/runtime-processes.ts",
        import.meta.url
      ),
      "utf8"
    ),
    readFile(
      new URL(
        "../../packages/process-supervisor/src/index.test.ts",
        import.meta.url
      ),
      "utf8"
    )
  ]);

  assert.match(coreRuntime, /processEnvironment\(env, REALTIME_KEYS/u);
  assert.match(coreRuntime, /processEnvironment\(env, WEB_PUSH_KEYS/u);
  assert.match(executionRuntime, /const RANK_KEYS/u);
  assert.match(executionRuntime, /const CONNECTOR_KEYS/u);
  assert.match(executionRuntime, /const AUTH_EMAIL_KEYS/u);
  assert.match(executionRuntime, /INTEGRATION_CREDENTIAL_ROLE: "DISABLED"/u);
  assert.match(executionRuntime, /INTEGRATION_CREDENTIAL_ROLE: "EXECUTION"/u);
  assert.match(supervisorTest, /FORBIDDEN_SECRET/u);
  assert.match(supervisorTest, /must-not-leak/u);
});

test("token-bearing backends wait for the isolated deploy preflight", async () => {
  const document = parseYamlMappings(await readFile(composeUrl, "utf8"));

  for (const serviceName of ["backend-core", "backend-execution"]) {
    const service = resolveMapping(
      serviceMapping(document, serviceName),
      document
    );
    const dependencies = service.get("depends_on");
    assert.ok(dependencies && typeof dependencies === "object");
    const resolvedDependencies = resolveMapping(dependencies, document);
    const preflight = resolvedDependencies.get("service-token-preflight");
    assert.ok(preflight && typeof preflight === "object");
    assert.equal(
      resolveMapping(preflight, document).get("condition"),
      "service_completed_successfully"
    );
  }
});

test("email and VAPID private material are mapped only to owning containers", async () => {
  const document = parseYamlMappings(await readFile(composeUrl, "utf8"));
  const core = serviceEnvironment(document, "backend-core");
  const execution = serviceEnvironment(document, "backend-execution");
  const frontend = serviceEnvironment(document, "frontend");

  for (const key of [
    "EMAIL_FROM",
    "SMTP_HOST",
    "SMTP_USER",
    "SMTP_PASSWORD"
  ]) {
    assert.ok(execution.has(key), `backend-execution must receive ${key}`);
    assert.equal(core.has(key), false);
    assert.equal(frontend.has(key), false);
  }
  assert.ok(core.has("WEB_PUSH_VAPID_PRIVATE_KEY"));
  assert.equal(execution.has("WEB_PUSH_VAPID_PRIVATE_KEY"), false);
  assert.equal(frontend.has("WEB_PUSH_VAPID_PRIVATE_KEY"), false);
  assert.ok(core.has("TELEGRAM_ALERT_BOT_TOKEN"));
  assert.equal(execution.has("TELEGRAM_ALERT_BOT_TOKEN"), false);
  assert.equal(frontend.has("TELEGRAM_ALERT_BOT_TOKEN"), false);
});

test("the retired shared token and legacy process services are absent", async () => {
  const compose = await readFile(composeUrl, "utf8");
  assert.doesNotMatch(compose, /\bINTERNAL_API_TOKEN\b/u);
  for (const service of [
    "rank-worker",
    "connector-worker",
    "auth-email-worker",
    "realtime",
    "web-push-worker"
  ]) {
    assert.doesNotMatch(compose, new RegExp(`^  ${service}:$`, "mu"));
  }
});

function assertRequiredSelfInterpolation(value, token, serviceName) {
  assert.equal(
    typeof value,
    "string",
    `${serviceName} must assign ${token}`
  );
  const unquoted =
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
      ? value.slice(1, -1)
      : value;
  const interpolation = /^\$\{([A-Z][A-Z0-9_]*):\?[^}]+\}$/u.exec(
    unquoted
  );
  assert.ok(interpolation, `${serviceName} must require ${token}`);
  assert.equal(interpolation[1], token);
}
