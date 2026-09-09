import assert from "node:assert/strict";
import test from "node:test";
import {
  getToolCapability,
  projectToolCapabilities,
  toolCapabilities,
  toolProjectHref
} from "./tool-capabilities.ts";

const projectId = "01900000-0000-7000-8000-000000000001";

test("catalog exposes every implemented project workflow", () => {
  assert.deepEqual(
    toolCapabilities.map(({ slug }) => slug),
    ["http-status-checker", "serp"]
  );
});

test("every project workflow has a concrete launch route", () => {
  const projectTools = projectToolCapabilities();
  assert.ok(projectTools.length > 0);
  for (const tool of projectTools) {
    const href = toolProjectHref(tool, projectId);
    assert.equal(
      href,
      `/app/projects/${projectId}/tools/${tool.slug}`
    );
  }
});

test("history is advertised only for durable asynchronous workflows", () => {
  for (const tool of toolCapabilities) {
    if (tool.projectHistory) assert.equal(tool.asynchronous, true);
  }
});

test("unknown tool slugs do not resolve", () => {
  assert.equal(getToolCapability("missing"), undefined);
});
