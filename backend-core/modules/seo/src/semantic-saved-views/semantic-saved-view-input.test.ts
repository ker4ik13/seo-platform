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
const authority = { canManageShared: false };
const groupId = "01900000-0000-7000-8000-000000000010";
const appliedViewId = "01900000-0000-7000-8000-000000000011";
const config = {
  schemaVersion: 1,
  filters: { isTracked: true },
  sort: "UPDATED_DESC",
  columns: ["query", "updatedAt"],
  columnOrder: ["query", "frequency", "updatedAt"],
  density: "COMFORTABLE",
  queryIndicators: ["MULTIPLE_URLS"],
  columnWidths: { query: 480, updatedAt: 140 },
  pageSize: 500,
  groupSidebarWidth: 320,
  expandedGroupIds: [groupId],
  selectedGroupIds: [groupId],
  appliedViewId
};

test("accepts exact tenant-scoped saved-view commands", () => {
  assert.deepEqual(
    internalCreateSemanticSavedViewInput({
      ...scope,
      ...authority,
      name: "  В работе  ",
      scope: "PRIVATE",
      config
    }),
    { ...scope, ...authority, name: "В работе", scope: "PRIVATE", config }
  );
  assert.deepEqual(
    internalUpdateSemanticSavedViewInput({
      ...scope,
      ...authority,
      version: 2,
      config
    }),
    { ...scope, ...authority, version: 2, config }
  );
  assert.deepEqual(
    internalDeleteSemanticSavedViewInput({ ...scope, ...authority, version: 3 }),
    { ...scope, ...authority, version: 3 }
  );
  assert.equal(
    internalCreateSemanticSavedViewInput({
      ...scope,
      ...authority,
      name: "URL ИИ-выдачи",
      scope: "PRIVATE",
      config: { ...config, schemaVersion: 3 }
    }).config.schemaVersion,
    3
  );
});

test("rejects authority drift and malformed versioned config", () => {
  assert.throws(
    () =>
      internalCreateSemanticSavedViewInput({
        ...scope,
        ...authority,
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
        ...authority,
        version: 0,
        config
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticSavedViewInput({
        ...scope,
        ...authority,
        version: 1,
        config: { ...config, columnOrder: ["query"] }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalDeleteSemanticSavedViewInput({
        ...scope,
        ...authority,
        version: 1,
        injectedWorkspaceId: workspaceId
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticSavedViewInput({
        ...scope,
        ...authority,
        version: 1,
        config: {
          ...config,
          queryIndicators: ["MULTIPLE_URLS", "MULTIPLE_URLS"]
        }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticSavedViewInput({
        ...scope,
        ...authority,
        version: 1,
        config: { ...config, queryIndicators: ["UNKNOWN"] }
      }),
    BadRequestException
  );
});
