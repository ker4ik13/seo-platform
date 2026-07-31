import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticClusterInput,
  semanticClusterPageBulkInput,
  updateSemanticClusterInput
} from "./semantic-cluster-input.js";

const clusterId = "01900000-0000-7000-8000-000000000001";
const pageId = "01900000-0000-7000-8000-000000000002";

test("normalizes exact semantic cluster commands", () => {
  assert.deepEqual(createSemanticClusterInput({ name: "  Купить   SEO  " }), {
    name: "Купить SEO"
  });
  assert.deepEqual(updateSemanticClusterInput({ name: "SEO аудит" }), {
    name: "SEO аудит"
  });
  assert.deepEqual(
    updateSemanticClusterInput({
      name: "SEO аудит",
      primaryPageId: "01900000-0000-7000-8000-000000000010",
      pageMappingSource: "MANUAL",
      pageMappingConfidence: 0.8,
      pageMappingRationale: "  Совпадает интент  "
    }),
    {
      name: "SEO аудит",
      primaryPageId: "01900000-0000-7000-8000-000000000010",
      pageMappingSource: "MANUAL",
      pageMappingConfidence: 0.8,
      pageMappingRationale: "Совпадает интент"
    }
  );
});

test("rejects empty, oversized and unsupported cluster fields", () => {
  assert.throws(() => createSemanticClusterInput({ name: " " }), DomainError);
  assert.throws(
    () => createSemanticClusterInput({ name: "x".repeat(256) }),
    DomainError
  );
  assert.throws(
    () => createSemanticClusterInput({ name: "SEO", projectId: "forged" }),
    DomainError
  );
  assert.throws(
    () => createSemanticClusterInput({
      name: "SEO",
      pageMappingSource: "MANUAL"
    }),
    DomainError
  );
  assert.throws(
    () => updateSemanticClusterInput({
      name: "SEO",
      primaryPageId: null,
      pageMappingConfidence: 0.5
    }),
    DomainError
  );
});

test("normalizes an exact cluster page mapping preview command", () => {
  assert.deepEqual(
    semanticClusterPageBulkInput({
      items: [{ id: clusterId.toUpperCase(), version: 4 }],
      primaryPageId: pageId.toUpperCase(),
      pageMappingSource: "MANUAL",
      pageMappingRationale: "  Совпадает интент  "
    }),
    {
      items: [{ id: clusterId, version: 4 }],
      primaryPageId: pageId,
      pageMappingSource: "MANUAL",
      pageMappingRationale: "Совпадает интент"
    }
  );
});

test("rejects unsafe cluster page mapping commands", () => {
  assert.throws(
    () => semanticClusterPageBulkInput({ items: [], primaryPageId: null }),
    DomainError
  );
  assert.throws(
    () =>
      semanticClusterPageBulkInput({
        items: [
          { id: clusterId, version: 1 },
          { id: clusterId, version: 2 }
        ],
        primaryPageId: pageId
      }),
    DomainError
  );
  assert.throws(
    () =>
      semanticClusterPageBulkInput({
        items: [{ id: clusterId, version: 1 }],
        primaryPageId: null,
        pageMappingSource: "MANUAL"
      }),
    DomainError
  );
});
