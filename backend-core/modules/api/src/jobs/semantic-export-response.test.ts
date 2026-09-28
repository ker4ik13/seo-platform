import assert from "node:assert/strict";
import test from "node:test";
import {
  scopedSemanticExportCollection,
  scopedSemanticExportSummary,
  semanticExportDownload
} from "./semantic-export-response.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const exportId = "01900000-0000-7000-8000-000000000003";

test("maps a bounded tenant-scoped semantic export", () => {
  const summary = scopedSemanticExportSummary(
    validSummary(),
    workspaceId,
    projectId,
    exportId
  );
  assert.equal(summary.format, "XLSX");
  assert.equal(summary.rowCount, 2_002);
  assert.equal(
    scopedSemanticExportCollection(
      { exports: [validSummary()] },
      workspaceId,
      projectId
    ).exports.length,
    1
  );
});

test("accepts an expired export without exposing a download URL", () => {
  const summary = scopedSemanticExportSummary(
    { ...validSummary(), status: "EXPIRED", stage: "expired" },
    workspaceId,
    projectId,
    exportId
  );
  assert.equal(summary.status, "EXPIRED");
});

test("rejects cross-tenant and extensible export responses", () => {
  assert.throws(() =>
    scopedSemanticExportSummary(
      { ...validSummary(), workspaceId: projectId },
      workspaceId,
      projectId
    )
  );
  assert.throws(() =>
    scopedSemanticExportSummary(
      { ...validSummary(), objectKey: "must-not-leak" },
      workspaceId,
      projectId
    )
  );
});

test("accepts only a safe signed HTTP download projection", () => {
  assert.equal(
    semanticExportDownload({
      url: "https://storage.example.test/export.xlsx?signature=opaque",
      filename: "semantic-core-2026-08-12.xlsx",
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      rowCount: 2_002,
      sizeBytes: "123456"
    }).rowCount,
    2_002
  );
  assert.throws(() =>
    semanticExportDownload({
      url: "ftp://storage.example.test/export.xlsx",
      filename: "../export.xlsx",
      contentType: "application/octet-stream",
      rowCount: 1,
      sizeBytes: "1"
    })
  );
});

function validSummary(): Readonly<Record<string, unknown>> {
  return {
    id: exportId,
    workspaceId,
    projectId,
    format: "XLSX",
    scope: "FULL_CORE",
    status: "COMPLETED",
    stage: "completed",
    processedRows: 2_002,
    totalRows: 2_002,
    rowCount: 2_002,
    filename: "semantic-core-2026-08-12.xlsx",
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    sizeBytes: "123456",
    version: 7,
    createdAt: "2026-08-12T10:00:00.000Z",
    updatedAt: "2026-08-12T10:01:00.000Z",
    startedAt: "2026-08-12T10:00:01.000Z",
    finishedAt: "2026-08-12T10:01:00.000Z"
  };
}
