import assert from "node:assert/strict";
import test from "node:test";
import {
  getToolCapability,
  publicToolCapabilities,
  toolCapabilities,
  toolProjectHref
} from "./tool-capabilities.ts";

const projectId = "01900000-0000-7000-8000-000000000001";

test("public catalog contains only capabilities with an implemented client runner", () => {
  assert.deepEqual(
    publicToolCapabilities().map(({ slug }) => slug),
    ["keyword-cleaner", "serp-snippet-preview"]
  );
  assert.ok(
    publicToolCapabilities().every(
      ({ runtime }) => runtime.kind === "PUBLIC_CLIENT"
    )
  );
});

test("every project workflow has a concrete launch route", () => {
  const projectTools = toolCapabilities.filter(
    ({ runtime }) => runtime.kind === "PROJECT_WORKFLOW"
  );
  assert.ok(projectTools.length > 0);
  for (const tool of projectTools) {
    const href = toolProjectHref(tool, projectId);
    assert.match(href, /^\/app\/(?:semantics|projects\/)/u);
    assert.doesNotMatch(href, /tools\/[^/]+$/u);
  }
});

test("history is advertised only for durable asynchronous workflows", () => {
  for (const tool of toolCapabilities) {
    if (tool.projectHistory) assert.equal(tool.asynchronous, true);
    if (tool.runtime.kind === "PUBLIC_CLIENT") {
      assert.equal(tool.asynchronous, false);
      assert.equal(tool.projectHistory, false);
    }
  }
});

test("unknown tool slugs do not resolve", () => {
  assert.equal(getToolCapability("missing"), undefined);
});
