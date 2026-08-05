import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const secretName = "JOBS_TO_SEO_RANK_TOKEN";
const expectedAssignment =
  "JOBS_TO_SEO_RANK_TOKEN: ${JOBS_TO_SEO_RANK_TOKEN:?JOBS_TO_SEO_RANK_TOKEN is required}";

test("rank token reaches preflight and the two backend containers", async () => {
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
      if (serviceMatch) {
        currentService = serviceMatch[1];
      }
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
    ["service-token-preflight", "backend-core", "backend-execution"],
    `${secretName} must not reach migrations, frontend or infrastructure runtimes`
  );
  assert.deepEqual(
    occurrences.map(({ line }) => line),
    [expectedAssignment, expectedAssignment, expectedAssignment],
    `${secretName} must be explicitly required by the preflight and both allowed runtime services`
  );
});
