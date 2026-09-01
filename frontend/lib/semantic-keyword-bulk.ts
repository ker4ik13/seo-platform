import {
  semanticKeywordBulkCommandMaxItems,
  type SemanticKeywordBulkInput,
  type SemanticKeywordBulkPatch,
  type SemanticKeywordBulkResult,
  type SemanticKeywordBulkSelection,
  type SemanticKeywordCleaningInput,
  type SemanticKeywordCleaningPreview,
  type SemanticKeywordCleaningResult,
  type SemanticKeywordCleaningRules
} from "@seo-platform/contracts";
import { browserApiRequest } from "./browser-api.ts";
import { semanticBulkSelectionBatches } from "./semantic-row-selection.ts";

type SemanticKeywordBulkExecutor = (
  projectId: string,
  input: SemanticKeywordBulkInput
) => Promise<SemanticKeywordBulkResult>;

type SemanticKeywordCleaningPreviewExecutor = (
  projectId: string,
  input: SemanticKeywordCleaningInput
) => Promise<SemanticKeywordCleaningPreview>;

type SemanticKeywordCleaningExecutor = (
  projectId: string,
  input: SemanticKeywordCleaningInput
) => Promise<SemanticKeywordCleaningResult>;

/**
 * Keeps the 200-row synchronous command boundary internal: callers always
 * operate on the complete selection and receive one aggregate result.
 */
export async function updateSemanticKeywordsInBatches(
  projectId: string,
  selections: readonly SemanticKeywordBulkSelection[],
  patch: SemanticKeywordBulkPatch,
  execute: SemanticKeywordBulkExecutor = executeKeywordBulkCommand
): Promise<SemanticKeywordBulkResult> {
  assertSelection(selections);
  let aggregate = emptyBulkResult();
  for (const items of selectionBatches(selections)) {
    aggregate = mergeBulkResults(
      aggregate,
      await execute(projectId, { items, patch })
    );
  }
  return aggregate;
}

export async function previewSemanticKeywordCleaningInBatches(
  projectId: string,
  selections: readonly SemanticKeywordBulkSelection[],
  rules: SemanticKeywordCleaningRules,
  execute: SemanticKeywordCleaningPreviewExecutor = executeCleaningPreview
): Promise<SemanticKeywordCleaningPreview> {
  assertSelection(selections);
  let aggregate = emptyCleaningPreview();
  for (const items of selectionBatches(selections)) {
    aggregate = mergeCleaningPreviews(
      aggregate,
      await execute(projectId, { items, rules })
    );
  }
  return aggregate;
}

export async function cleanSemanticKeywordsInBatches(
  projectId: string,
  selections: readonly SemanticKeywordBulkSelection[],
  rules: SemanticKeywordCleaningRules,
  execute: SemanticKeywordCleaningExecutor = executeCleaningCommand
): Promise<SemanticKeywordCleaningResult> {
  assertSelection(selections);
  let aggregate = emptyCleaningResult();
  for (const items of selectionBatches(selections)) {
    aggregate = mergeCleaningResults(
      aggregate,
      await execute(projectId, { items, rules })
    );
  }
  return aggregate;
}

function selectionBatches(
  selections: readonly SemanticKeywordBulkSelection[]
): readonly SemanticKeywordBulkSelection[][] {
  return semanticBulkSelectionBatches(
    selections,
    semanticKeywordBulkCommandMaxItems
  );
}

function assertSelection(
  selections: readonly SemanticKeywordBulkSelection[]
): void {
  if (selections.length === 0) {
    throw new RangeError("At least one semantic keyword must be selected");
  }
}

async function executeKeywordBulkCommand(
  projectId: string,
  input: SemanticKeywordBulkInput
): Promise<SemanticKeywordBulkResult> {
  return browserApiRequest<SemanticKeywordBulkResult>(
    `/app/api/projects/${encodeURIComponent(projectId)}/bulk-commands`,
    { method: "POST", body: input }
  );
}

async function executeCleaningPreview(
  projectId: string,
  input: SemanticKeywordCleaningInput
): Promise<SemanticKeywordCleaningPreview> {
  return browserApiRequest<SemanticKeywordCleaningPreview>(
    `/app/api/projects/${encodeURIComponent(projectId)}/bulk-commands/clean-preview`,
    { method: "POST", body: input }
  );
}

async function executeCleaningCommand(
  projectId: string,
  input: SemanticKeywordCleaningInput
): Promise<SemanticKeywordCleaningResult> {
  return browserApiRequest<SemanticKeywordCleaningResult>(
    `/app/api/projects/${encodeURIComponent(projectId)}/bulk-commands/clean`,
    { method: "POST", body: input }
  );
}

function emptyBulkResult(): SemanticKeywordBulkResult {
  return {
    selected: 0,
    changed: 0,
    skipped: 0,
    failed: 0,
    conflicted: 0,
    updatedItems: [],
    conflictedIds: [],
    skippedIds: [],
    failedIds: []
  };
}

function mergeBulkResults(
  left: SemanticKeywordBulkResult,
  right: SemanticKeywordBulkResult
): SemanticKeywordBulkResult {
  return {
    selected: left.selected + right.selected,
    changed: left.changed + right.changed,
    skipped: left.skipped + right.skipped,
    failed: left.failed + right.failed,
    conflicted: left.conflicted + right.conflicted,
    updatedItems: [...left.updatedItems, ...right.updatedItems],
    conflictedIds: [...left.conflictedIds, ...right.conflictedIds],
    skippedIds: [...left.skippedIds, ...right.skippedIds],
    failedIds: [...left.failedIds, ...right.failedIds]
  };
}

function emptyCleaningPreview(): SemanticKeywordCleaningPreview {
  return {
    selected: 0,
    applicable: 0,
    unchanged: 0,
    conflicted: 0,
    failed: 0,
    changes: []
  };
}

function mergeCleaningPreviews(
  left: SemanticKeywordCleaningPreview,
  right: SemanticKeywordCleaningPreview
): SemanticKeywordCleaningPreview {
  return {
    selected: left.selected + right.selected,
    applicable: left.applicable + right.applicable,
    unchanged: left.unchanged + right.unchanged,
    conflicted: left.conflicted + right.conflicted,
    failed: left.failed + right.failed,
    changes: [...left.changes, ...right.changes]
  };
}

function emptyCleaningResult(): SemanticKeywordCleaningResult {
  return {
    selected: 0,
    changed: 0,
    unchanged: 0,
    conflicted: 0,
    failed: 0,
    updatedItems: [],
    unchangedIds: [],
    conflictedIds: [],
    failedIds: []
  };
}

function mergeCleaningResults(
  left: SemanticKeywordCleaningResult,
  right: SemanticKeywordCleaningResult
): SemanticKeywordCleaningResult {
  return {
    selected: left.selected + right.selected,
    changed: left.changed + right.changed,
    unchanged: left.unchanged + right.unchanged,
    conflicted: left.conflicted + right.conflicted,
    failed: left.failed + right.failed,
    updatedItems: [...left.updatedItems, ...right.updatedItems],
    unchangedIds: [...left.unchangedIds, ...right.unchangedIds],
    conflictedIds: [...left.conflictedIds, ...right.conflictedIds],
    failedIds: [...left.failedIds, ...right.failedIds]
  };
}
