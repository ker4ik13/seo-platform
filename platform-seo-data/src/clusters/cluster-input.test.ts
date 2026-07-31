import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticClusterInput,
  internalDeleteSemanticClusterInput,
  internalSemanticClusterPageBulkInput,
  internalUpdateSemanticClusterInput
} from "./cluster-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("accepts exact tenant-scoped cluster commands", () => {
  assert.equal(
    internalCreateSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      name: "  SEO   аудит "
    }).name,
    "SEO аудит"
  );
  assert.equal(
    internalUpdateSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      name: "Аудит сайта",
      version: 2
    }).version,
    2
  );
  assert.deepEqual(
    internalUpdateSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      name: "Аудит сайта",
      primaryPageId: "01900000-0000-7000-8000-000000000010",
      pageMappingSource: "SERP",
      pageMappingConfidence: 0.75,
      pageMappingRationale: "  Совпадение выдачи  ",
      version: 2
    }).pageMappingRationale,
    "Совпадение выдачи"
  );
  assert.equal(
    internalDeleteSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      version: 3
    }).version,
    3
  );
});

test("rejects malformed and forged internal cluster commands", () => {
  assert.throws(
    () =>
      internalCreateSemanticClusterInput({
        workspaceId,
        projectId,
        actorId,
        name: "SEO",
        version: 1
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticClusterInput({
        workspaceId,
        projectId,
        actorId,
        name: "SEO",
        version: 0
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateSemanticClusterInput({
        workspaceId,
        projectId,
        actorId,
        name: "SEO",
        pageMappingConfidence: 2
      }),
    BadRequestException
  );
});

test("accepts and scopes an exact internal cluster page mapping command", () => {
  assert.deepEqual(
    internalSemanticClusterPageBulkInput({
      workspaceId,
      projectId,
      actorId,
      items: [{ id: "01900000-0000-7000-8000-000000000004", version: 3 }],
      primaryPageId: "01900000-0000-7000-8000-000000000005",
      pageMappingSource: "SERP",
      pageMappingConfidence: 0.9,
      pageMappingRationale: "  Результаты выдачи  "
    }),
    {
      workspaceId,
      projectId,
      actorId,
      items: [{ id: "01900000-0000-7000-8000-000000000004", version: 3 }],
      primaryPageId: "01900000-0000-7000-8000-000000000005",
      pageMappingSource: "SERP",
      pageMappingConfidence: 0.9,
      pageMappingRationale: "Результаты выдачи"
    }
  );
});

test("rejects duplicate or contradictory internal page mapping commands", () => {
  const item = { id: "01900000-0000-7000-8000-000000000004", version: 3 };
  assert.throws(
    () =>
      internalSemanticClusterPageBulkInput({
        workspaceId,
        projectId,
        actorId,
        items: [item, item],
        primaryPageId: null
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSemanticClusterPageBulkInput({
        workspaceId,
        projectId,
        actorId,
        items: [item],
        primaryPageId: null,
        pageMappingRationale: "Нельзя сохранить без страницы"
      }),
    BadRequestException
  );
});
