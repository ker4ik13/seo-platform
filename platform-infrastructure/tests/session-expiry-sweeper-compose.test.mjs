import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseYamlMappings,
  serviceEnvironment,
  serviceNames,
  stripMatchingQuotes
} from "./helpers/compose-mappings.mjs";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
const rootEnvUrl = new URL("../../.env.example", import.meta.url);

const sweeperEnvironment = new Map([
  ["SESSION_EXPIRY_SWEEPER_ENABLED", "true"],
  ["SESSION_EXPIRY_SWEEPER_INTERVAL_MS", "60000"],
  ["SESSION_EXPIRY_SWEEPER_BATCH_SIZE", "50"],
  ["SESSION_EXPIRY_SWEEPER_TRANSACTION_TIMEOUT_MS", "10000"],
  ["SESSION_EXPIRY_SWEEPER_LOCK_TIMEOUT_MS", "500"]
]);

test("production enables the bounded session-expiry sweeper only in Platform API", async () => {
  const [compose, rootEnv] = await Promise.all([
    readFile(composeUrl, "utf8"),
    readFile(rootEnvUrl, "utf8")
  ]);
  const document = parseYamlMappings(compose);
  const platformApi = serviceEnvironment(document, "platform-api");
  const documented = parseEnv(rootEnv);

  for (const [name, fallback] of sweeperEnvironment) {
    assert.equal(documented.get(name), fallback, `${name} root default drifted`);
    const actual = stripMatchingQuotes(platformApi.get(name));
    if (name === "SESSION_EXPIRY_SWEEPER_ENABLED") {
      assert.equal(actual, "true");
    } else {
      assert.equal(actual, `\${${name}:-${fallback}}`);
    }

    for (const serviceName of serviceNames(document)) {
      if (serviceName === "platform-api") continue;
      const environment = serviceEnvironment(document, serviceName, false);
      assert.equal(
        environment?.has(name) ?? false,
        false,
        `${name} must not reach ${serviceName}`
      );
    }
  }
});

function parseEnv(source) {
  const values = new Map();
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (line === "" || line.startsWith("#")) continue;
    const separator = line.indexOf("=");
    assert.ok(separator > 0, `invalid env example line: ${line}`);
    const name = line.slice(0, separator);
    assert.equal(values.has(name), false, `duplicate env example key: ${name}`);
    values.set(name, line.slice(separator + 1));
  }
  return values;
}
