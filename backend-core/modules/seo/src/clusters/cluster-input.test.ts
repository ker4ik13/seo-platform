import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticClusterInput,
  internalDeleteSemanticClusterInput,
  internalSemanticClusterMergeInput,
  internalSemanticClusterSplitInput,
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
      name: "  SEO   аудит ",
      isLocked: true,
      excludeFromReclustering: true
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

test("accepts only an exact scoped cluster merge", () => {
  const first = "01900000-0000-7000-8000-000000000004";
  const second = "01900000-0000-7000-8000-000000000005";
  assert.deepEqual(
    internalSemanticClusterMergeInput({
      workspaceId,
      projectId,
      actorId,
      items: [
        { id: first, version: 2 },
        { id: second, version: 3 }
      ],
      targetClusterId: second
    }),
    {
      workspaceId,
      projectId,
      actorId,
      items: [
        { id: first, version: 2 },
        { id: second, version: 3 }
      ],
      targetClusterId: second
    }
  );
  assert.throws(
    () => internalSemanticClusterMergeInput({
      workspaceId,
      projectId,
      actorId,
      items: [
        { id: first, version: 2 },
        { id: second, version: 3 }
      ],
      targetClusterId: "01900000-0000-7000-8000-000000000099"
    }),
    BadRequestException
  );
});

test("accepts only an exact scoped cluster split", () => {
  const keywordId = "01900000-0000-7000-8000-000000000020";
  assert.equal(
    internalSemanticClusterSplitInput({
      workspaceId,
      projectId,
      actorId,
      sourceCluster: {
        id: "01900000-0000-7000-8000-000000000004",
        version: 3
      },
      keywordItems: [{ id: keywordId, version: 5 }],
      newClusterName: "  Коммерческий   интент ",
      isLocked: true
    }).newClusterName,
    "Коммерческий интент"
  );
  assert.throws(
    () => internalSemanticClusterSplitInput({
      workspaceId,
      projectId,
      actorId,
      sourceCluster: {
        id: "01900000-0000-7000-8000-000000000004",
        version: 3
      },
      keywordItems: [],
      newClusterName: "Новый"
    }),
    BadRequestException
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
