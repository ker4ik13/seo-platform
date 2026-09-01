import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  assertEmptyApiTokenActionInput,
  createApiTokenInput
} from "./api-token-input.js";

const projectId = "01900000-0000-7000-8000-000000000001";

test("normalizes and orders API token scopes", () => {
  const result = createApiTokenInput({
    name: "  SEO agent  ",
    scopes: ["frequency:run", "projects:read", "positions:read"],
    allProjects: false,
    projectIds: [projectId],
    expiresAt: null
  });

  assert.deepEqual(result, {
    name: "SEO agent",
    scopes: ["projects:read", "positions:read", "frequency:run"],
    allProjects: false,
    projectIds: [projectId],
    expiresAt: null
  });
});

test("does not impose a presentation cap on a project allowlist", () => {
  const projectIds = Array.from({ length: 250 }, (_, index) =>
    `01900000-0000-7000-8${String(Math.floor(index / 100)).padStart(3, "0")}-${String(index).padStart(12, "0")}`
  );
  const result = createApiTokenInput({
    name: "Large restricted agent",
    scopes: ["projects:read"],
    allProjects: false,
    projectIds,
    expiresAt: null
  });

  assert.deepEqual(result.projectIds, projectIds);
});

test("rejects an empty project allowlist and unknown scopes", () => {
  for (const input of [
    {
      name: "Agent",
      scopes: ["projects:read"],
      allProjects: false,
      projectIds: [],
      expiresAt: null
    },
    {
      name: "Agent",
      scopes: ["billing:write"],
      allProjects: true,
      projectIds: [],
      expiresAt: null
    }
  ]) {
    assert.throws(
      () => createApiTokenInput(input),
      (error: unknown) =>
        error instanceof DomainError && error.code === "VALIDATION_FAILED"
    );
  }
});

test("accepts only an exact empty action body", () => {
  assert.doesNotThrow(() => assertEmptyApiTokenActionInput({}));
  assert.throws(() => assertEmptyApiTokenActionInput({ confirm: true }));
});
