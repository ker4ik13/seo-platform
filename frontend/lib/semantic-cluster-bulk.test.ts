import assert from "node:assert/strict";
import test from "node:test";
import type {
  SemanticClusterPageBulkInput,
  SemanticClusterPageBulkPreview,
  SemanticClusterPageBulkResult
} from "@seo-platform/contracts";
import {
  applySemanticClusterPageMappingInBatches,
  previewSemanticClusterPageMappingInBatches
} from "./semantic-cluster-bulk.ts";

const input: SemanticClusterPageBulkInput = {
  items: Array.from({ length: 457 }, (_, index) => ({
    id: `cluster-${index}`,
    version: index + 1
  })),
  primaryPageId: "page-id",
  pageMappingSource: "MANUAL"
};

test("page mapping keeps all clusters while using bounded API batches", async () => {
  const previewSizes: number[] = [];
  const preview = await previewSemanticClusterPageMappingInBatches(
    "project-id",
    input,
    async (_projectId, batch): Promise<SemanticClusterPageBulkPreview> => {
      previewSizes.push(batch.items.length);
      return {
        selected: batch.items.length,
        applicable: batch.items.length,
        skipped: 0,
        conflicted: 0,
        changes: batch.items.map(({ id, version }) => ({
          clusterId: id,
          state: "APPLICABLE",
          expectedVersion: version
        }))
      };
    }
  );
  assert.deepEqual(previewSizes, [200, 200, 57]);
  assert.equal(preview.selected, 457);
  assert.equal(preview.changes.length, 457);

  const applySizes: number[] = [];
  const result = await applySemanticClusterPageMappingInBatches(
    "project-id",
    input,
    async (_projectId, batch): Promise<SemanticClusterPageBulkResult> => {
      applySizes.push(batch.items.length);
      return {
        selected: batch.items.length,
        changed: batch.items.length,
        skipped: 0,
        conflicted: 0,
        updatedClusters: [],
        skippedIds: [],
        conflictedIds: []
      };
    }
  );
  assert.deepEqual(applySizes, [200, 200, 57]);
  assert.equal(result.selected, 457);
  assert.equal(result.changed, 457);
});
