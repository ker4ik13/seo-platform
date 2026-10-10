import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCancelSemanticImportInput,
  internalConfigureSemanticImportInput,
  internalConfirmSemanticImportInput,
  internalCreateSemanticImportInput,
  semanticImportPreviewRowsQuery
} from "./semantic-import-input.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
} as const;
const entitlement = {
  planCode: "TEAM",
  planVersion: 1,
  storedKeywords: 2_000_000,
  keywordsPerProject: 2_000_000,
  foldersPerProject: 500,
  trackedContextPairs: 50_000
} as const;

test("parses bounded semantic import preview pagination and sorting", () => {
  assert.deepEqual(
    semanticImportPreviewRowsQuery("cursor_1", "12", "DESC"),
    { cursor: "cursor_1", sortColumn: 12, sortDirection: "DESC" }
  );
  assert.deepEqual(
    semanticImportPreviewRowsQuery(undefined, "0", undefined),
    { sortColumn: 0, sortDirection: "ASC" }
  );
  assert.throws(
    () => semanticImportPreviewRowsQuery(undefined, "1109", "ASC"),
    BadRequestException
  );
  assert.throws(
    () => semanticImportPreviewRowsQuery(undefined, undefined, "DESC"),
    BadRequestException
  );
});

test("captures a normalized trusted project domain for imported SERP", () => {
  const result = internalCreateSemanticImportInput({
    ...context,
    projectDomain: "Example.COM",
    uploadId: "01900000-0000-7000-8000-000000000005",
    idempotencyKey: "semantic-import-1",
    jobCapacity: {
      planCode: "TEAM",
      planVersion: 1,
      concurrentJobs: 8
    },
    semanticCapacity: entitlement
  });

  assert.equal(result.projectDomain, "example.com");
  assert.deepEqual(result.semanticCapacity, entitlement);
  assert.equal(
    internalCreateSemanticImportInput({
      ...context,
      projectDomain: "example.com",
      uploadId: "01900000-0000-7000-8000-000000000006",
      idempotencyKey: "semantic-import-legacy",
      jobCapacity: {
        planCode: "TEAM",
        planVersion: 1,
        concurrentJobs: 8
      }
    }).semanticCapacity,
    undefined
  );
  assert.throws(
    () => internalCreateSemanticImportInput({
      ...result,
      projectDomain: "https://example.com/private"
    }),
    BadRequestException
  );
});

test("parses mapping, confirmation and monotonic cancellation commands", () => {
  assert.deepEqual(
    internalConfigureSemanticImportInput({
      ...context,
      version: 3,
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "custom", customName: "Score" }
      ],
      defaultLanguage: "en",
      groupSeparator: ">",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: true
    }),
    {
      ...context,
      version: 3,
      columns: [
        { sourceIndex: 0, target: "keyword.text" },
        { sourceIndex: 1, target: "custom", customName: "Score" }
      ],
      defaultLanguage: "en",
      groupSeparator: ">",
      duplicatePolicy: "MERGE_NON_EMPTY",
      createMissingKeywords: true
    }
  );
  assert.equal(
    internalConfigureSemanticImportInput({
      ...context,
      version: 4,
      columns: [{ sourceIndex: 0, target: "keyword.text" }]
    }).createMissingKeywords,
    false
  );
  assert.throws(
    () =>
      internalConfigureSemanticImportInput({
        ...context,
        version: 4,
        columns: [{ sourceIndex: 0, target: "keyword.text" }],
        createMissingKeywords: "true"
      }),
    BadRequestException
  );
  assert.equal(
    internalConfirmSemanticImportInput({
      ...context,
      version: 4,
      entitlement
    }).version,
    4
  );
  assert.equal(
    internalCancelSemanticImportInput(context).version,
    undefined
  );
});

test("rejects duplicate singleton targets and missing custom names", () => {
  assert.throws(
    () =>
      internalConfigureSemanticImportInput({
        ...context,
        version: 1,
        columns: [
          { sourceIndex: 0, target: "keyword.text" },
          { sourceIndex: 1, target: "keyword.text" }
        ]
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalConfigureSemanticImportInput({
        ...context,
        version: 1,
        columns: [
          { sourceIndex: 0, target: "keyword.text" },
          { sourceIndex: 1, target: "custom" }
        ]
      }),
    BadRequestException
  );
});

test("accepts a trusted one-snapshot positions mapping", () => {
  const result = internalConfigureSemanticImportInput({
    ...context,
    version: 8,
    columns: [
      { sourceIndex: 0, target: "keyword.text" },
      { sourceIndex: 1, target: "ranking.position" },
      { sourceIndex: 2, target: "ranking.url" }
    ],
    defaultLanguage: "ru",
    groupSeparator: "/",
    duplicatePolicy: "MERGE_NON_EMPTY",
    createMissingKeywords: false,
    positionHistory: {
      layout: "LONG",
      observedAt: "2026-09-16T12:00:00.000Z",
      searchEngine: "YANDEX",
      countryCode: "RU",
      regionCode: "213",
      regionLabel: "Москва",
      language: "ru",
      device: "DESKTOP"
    }
  });
  assert.equal(result.columns[1]?.target, "ranking.position");
  assert.equal(result.columns[2]?.target, "ranking.url");
  assert.equal(result.positionHistory?.observedAt, "2026-09-16T12:00:00.000Z");
});
