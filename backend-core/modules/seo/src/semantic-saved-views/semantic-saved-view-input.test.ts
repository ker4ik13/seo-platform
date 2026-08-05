import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticSavedViewInput,
  internalDeleteSemanticSavedViewInput,
  internalUpdateSemanticSavedViewInput
} from "./semantic-saved-view-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const scope = { workspaceId, projectId, actorId };
const config = {
  schemaVersion: 1,
  filters: { isTracked: true },
  sort: "UPDATED_DESC",
  columns: ["query", "updatedAt"],
  density: "COMFORTABLE"
};

test("accepts exact tenant-scoped saved-view commands", () => {
  assert.deepEqual(
    internalCreateSemanticSavedViewInput({
      ...scope,
      name: "  В работе  ",
      scope: "PRIVATE",
      config
    }),
    { ...scope, name: "В работе", scope: "PRIVATE", config }
  );
  assert.deepEqual(
    internalUpdateSemanticSavedViewInput({
      ...scope,
      version: 2,
      config
    }),
    { ...scope, version: 2, config }
  );
  assert.deepEqual(
    internalDeleteSemanticSavedViewInput({ ...scope, version: 3 }),
    { ...scope, version: 3 }
  );
});

test("rejects authority drift and malformed versioned config", () => {
  assert.throws(
    () =>
      internalCreateSemanticSavedViewInput({
        ...scope,
        name: "Broken",
        scope: "WORKSPACE_TEMPLATE",
        config
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticSavedViewInput({
        ...scope,
        version: 0,
        config
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalDeleteSemanticSavedViewInput({
        ...scope,
        version: 1,
        injectedWorkspaceId: workspaceId
      }),
    BadRequestException
  );
});
