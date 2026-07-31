import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  createSemanticClusterInput,
  updateSemanticClusterInput
} from "./semantic-cluster-input.js";

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
