import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  parseYamlMappings,
  resolveMapping,
  serviceEnvironment,
  serviceMapping,
  serviceNames,
  stripMatchingQuotes,
} from "./helpers/compose-mappings.mjs";

const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);

test("Compose fixes PostgreSQL and every Node runtime to UTC", async () => {
  const source = await readFile(composeUrl, "utf8");
  const document = parseYamlMappings(source);
  const nodeServices = [];

  for (const serviceName of serviceNames(document)) {
    const service = resolveMapping(serviceMapping(document, serviceName), document);
    const environment = serviceEnvironment(document, serviceName, false);
    if (!environment || stripMatchingQuotes(environment.get("NODE_ENV") ?? "") !== "production") {
      continue;
    }

    nodeServices.push(serviceName);
    assert.equal(
      stripMatchingQuotes(environment.get("TZ") ?? ""),
      "UTC",
      `${serviceName} must run in UTC`,
    );
    assert.ok(
      service.has("command") || service.has("build"),
      `${serviceName} must be a concrete runtime service`,
    );
  }

  assert.deepEqual(
    nodeServices.sort(),
    ["backend-core", "backend-execution", "frontend"]
  );
  assert.match(
    source,
    /command:\s*\[\s*"postgres",\s*"-c",\s*"hba_file=\/tmp\/seo-platform-pg_hba\.conf",\s*"-c",\s*"timezone=UTC"\s*\]/u,
  );
});
