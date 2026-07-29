import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const secretName = "JOBS_TO_SEO_RANK_TOKEN";
const expectedAssignment =
  "JOBS_TO_SEO_RANK_TOKEN: ${JOBS_TO_SEO_RANK_TOKEN:?JOBS_TO_SEO_RANK_TOKEN is required}";

test("dedicated rank token is passed only to seo-data HTTP", async () => {
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
    ["seo-data"],
    `${secretName} must not be inherited by shared anchors, migrations or generic workers`
  );
  assert.equal(
    occurrences[0]?.line,
    expectedAssignment,
    `${secretName} must be explicitly required by the seo-data service`
  );
});
