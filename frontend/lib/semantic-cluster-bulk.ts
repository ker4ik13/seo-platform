import {
  semanticClusterPageBulkMaxItems,
  type SemanticClusterPageBulkInput,
  type SemanticClusterPageBulkPreview,
  type SemanticClusterPageBulkResult
} from "@seo-platform/contracts";
import { browserApiRequest } from "./browser-api.ts";
import { semanticBulkSelectionBatches } from "./semantic-row-selection.ts";

type SemanticClusterPagePreviewExecutor = (
  projectId: string,
  input: SemanticClusterPageBulkInput
) => Promise<SemanticClusterPageBulkPreview>;

type SemanticClusterPageApplyExecutor = (
  projectId: string,
  input: SemanticClusterPageBulkInput
) => Promise<SemanticClusterPageBulkResult>;

export async function previewSemanticClusterPageMappingInBatches(
  projectId: string,
  input: SemanticClusterPageBulkInput,
  execute: SemanticClusterPagePreviewExecutor = executePreview
): Promise<SemanticClusterPageBulkPreview> {
  assertItems(input);
  let aggregate = emptyPreview();
  for (const batch of inputBatches(input)) {
    aggregate = mergePreviews(aggregate, await execute(projectId, batch));
  }
  return aggregate;
}

export async function applySemanticClusterPageMappingInBatches(
  projectId: string,
  input: SemanticClusterPageBulkInput,
  execute: SemanticClusterPageApplyExecutor = executeApply
): Promise<SemanticClusterPageBulkResult> {
  assertItems(input);
  let aggregate = emptyResult();
  for (const batch of inputBatches(input)) {
    aggregate = mergeResults(aggregate, await execute(projectId, batch));
  }
  return aggregate;
}

function inputBatches(
  input: SemanticClusterPageBulkInput
): readonly SemanticClusterPageBulkInput[] {
  return semanticBulkSelectionBatches(
    input.items,
    semanticClusterPageBulkMaxItems
  ).map((items) => ({ ...input, items }));
}

function assertItems(input: SemanticClusterPageBulkInput): void {
  if (input.items.length === 0) {
    throw new RangeError("At least one semantic cluster must be selected");
  }
}

async function executePreview(
  projectId: string,
  input: SemanticClusterPageBulkInput
): Promise<SemanticClusterPageBulkPreview> {
  return browserApiRequest<SemanticClusterPageBulkPreview>(
    `/app/api/projects/${encodeURIComponent(projectId)}/clusters/page-mapping-preview`,
    { method: "POST", body: input }
  );
}

async function executeApply(
  projectId: string,
  input: SemanticClusterPageBulkInput
): Promise<SemanticClusterPageBulkResult> {
  return browserApiRequest<SemanticClusterPageBulkResult>(
    `/app/api/projects/${encodeURIComponent(projectId)}/clusters/page-mapping-bulk`,
    { method: "POST", body: input }
  );
}

function emptyPreview(): SemanticClusterPageBulkPreview {
  return {
    selected: 0,
    applicable: 0,
    skipped: 0,
    conflicted: 0,
    changes: []
  };
}

function mergePreviews(
  left: SemanticClusterPageBulkPreview,
  right: SemanticClusterPageBulkPreview
): SemanticClusterPageBulkPreview {
  return {
    selected: left.selected + right.selected,
    applicable: left.applicable + right.applicable,
    skipped: left.skipped + right.skipped,
    conflicted: left.conflicted + right.conflicted,
    changes: [...left.changes, ...right.changes]
  };
}

function emptyResult(): SemanticClusterPageBulkResult {
  return {
    selected: 0,
    changed: 0,
    skipped: 0,
    conflicted: 0,
    updatedClusters: [],
    skippedIds: [],
    conflictedIds: []
  };
}

function mergeResults(
  left: SemanticClusterPageBulkResult,
  right: SemanticClusterPageBulkResult
): SemanticClusterPageBulkResult {
  return {
    selected: left.selected + right.selected,
    changed: left.changed + right.changed,
    skipped: left.skipped + right.skipped,
    conflicted: left.conflicted + right.conflicted,
    updatedClusters: [...left.updatedClusters, ...right.updatedClusters],
    skippedIds: [...left.skippedIds, ...right.skippedIds],
    conflictedIds: [...left.conflictedIds, ...right.conflictedIds]
  };
}
