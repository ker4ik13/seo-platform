import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const secretName = "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN";
const expectedAssignment =
  "JOBS_TO_PLATFORM_RANK_GRANT_TOKEN: ${JOBS_TO_PLATFORM_RANK_GRANT_TOKEN:?JOBS_TO_PLATFORM_RANK_GRANT_TOKEN is required}";

test("rank grant token is required only by Platform API and rank worker", async () => {
  const composeUrl = new URL("../compose.dokploy.yml", import.meta.url);
  const lines = (await readFile(composeUrl, "utf8")).split(/\r?\n/u);
  const occurrences = [];
  let insideServices = false;
  let currentService;

  for (const [lineIndex, line] of lines.entries()) {
    if (line === "services:") {
      insideServices = true;
      currentService = undefined;
      continue;
    }

    if (insideServices && /^\S/u.test(line)) {
      insideServices = false;
      currentService = undefined;
    }

    if (insideServices) {
      const serviceMatch = /^  ([a-z0-9][a-z0-9-]*):\s*$/u.exec(line);
      if (serviceMatch) currentService = serviceMatch[1];
    }

    if (line.includes(secretName)) {
      occurrences.push({
        line: line.trim(),
        lineNumber: lineIndex + 1,
        service: insideServices ? currentService : undefined
      });
    }
  }

  assert.deepEqual(
    occurrences.map(({ service }) => service),
    ["platform-api", "rank-worker"],
    `${secretName} must not reach shared anchors, migrations, Jobs HTTP or unrelated workers`
  );
  assert.deepEqual(
    occurrences.map(({ line }) => line),
    [expectedAssignment, expectedAssignment]
  );
});

test("rank grant token examples stay fail-closed and validation supplies a CI-only value", async () => {
  const rootExampleUrl = new URL("../../.env.example", import.meta.url);
  const serviceExampleUrl = new URL(
    "../../platform-api/.env.example",
    import.meta.url
  );
  const jobsExampleUrl = new URL(
    "../../platform-jobs-integrations/.env.example",
    import.meta.url
  );
  const packageUrl = new URL("../../package.json", import.meta.url);
  const [rootExample, serviceExample, jobsExample, packageText] = await Promise.all([
    readFile(rootExampleUrl, "utf8"),
    readFile(serviceExampleUrl, "utf8"),
    readFile(jobsExampleUrl, "utf8"),
    readFile(packageUrl, "utf8")
  ]);
  const packageJson = JSON.parse(packageText);

  assert.match(
    rootExample,
    /^JOBS_TO_PLATFORM_RANK_GRANT_TOKEN=$/mu,
    "the deploy example must require an operator-generated secret"
  );
  assert.match(
    serviceExample,
    /^JOBS_TO_PLATFORM_RANK_GRANT_TOKEN=replace-with-a-distinct-random-rank-grant-token$/mu
  );
  assert.match(
    jobsExample,
    /^JOBS_TO_PLATFORM_RANK_GRANT_TOKEN=$/mu,
    "the Jobs example must not ship a reusable rank grant secret"
  );
  assert.match(rootExample, /^PLATFORM_API_COMMAND_TIMEOUT_MS=5000$/mu);
  assert.match(jobsExample, /^PLATFORM_API_COMMAND_TIMEOUT_MS=5000$/mu);
  assert.match(jobsExample, /^PLATFORM_API_URL=http:\/\/platform-api:4000$/mu);
  assert.match(jobsExample, /^RANK_PROVIDER_SUBMIT_ENABLED=false$/mu);
  assert.match(
    jobsExample,
    /^RANK_PROVIDER_KILL_SWITCH_VERSION=arsenkin-positions@1$/mu
  );
  assert.match(
    packageJson.scripts["infra:validate:example"],
    /(?:^| )JOBS_TO_PLATFORM_RANK_GRANT_TOKEN=ci-only-distinct-platform-rank-grant-token(?: |$)/u
  );
});
