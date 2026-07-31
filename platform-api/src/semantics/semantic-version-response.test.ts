import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import {
  semanticVersionsResponse,
  semanticVersionUndoPreviewResponse
} from "./semantic-version-response.js";

const versionId = "01900000-0000-7000-8000-000000000010";
const actorId = "01900000-0000-7000-8000-000000000011";
const keywordId = "01900000-0000-7000-8000-000000000012";

test("validates finite semantic versions and coherent undo counts", () => {
  const version = semanticVersion();
  assert.deepEqual(semanticVersionsResponse([version]), [version]);
  assert.deepEqual(
    semanticVersionUndoPreviewResponse({
      version,
      applicable: 1,
      conflicted: 0,
      unsupported: 0,
      changes: [
        {
          entityType: "KEYWORD",
          entityId: keywordId,
          operation: "UPDATE",
          state: "APPLICABLE",
          expectedCurrentVersion: 2,
          currentVersion: 2
        }
      ]
    }).applicable,
    1
  );
  assert.equal(
    semanticVersionUndoPreviewResponse({
      version: { ...version, reason: "CLUSTER_UPDATE" },
      applicable: 1,
      conflicted: 0,
      unsupported: 0,
      changes: [
        {
          entityType: "CLUSTER",
          entityId: keywordId,
          operation: "UPDATE",
          state: "APPLICABLE",
          expectedCurrentVersion: 3,
          currentVersion: 3
        }
      ]
    }).changes[0]?.entityType,
    "CLUSTER"
  );
});

test("rejects extensible or contradictory semantic version responses", () => {
  assert.throws(
    () =>
      semanticVersionsResponse([
        { ...semanticVersion(), privateManifest: { secret: true } }
      ]),
    DomainError
  );
  assert.throws(
    () =>
      semanticVersionUndoPreviewResponse({
        version: semanticVersion(),
        applicable: 0,
        conflicted: 0,
        unsupported: 0,
        changes: [
          {
            entityType: "KEYWORD",
            entityId: keywordId,
            operation: "UPDATE",
            state: "APPLICABLE",
            expectedCurrentVersion: 2
          }
        ]
      }),
    DomainError
  );
});

function semanticVersion() {
  return {
    id: versionId,
    number: 2,
    reason: "KEYWORD_UPDATE",
    actorId,
    parentVersionId: "01900000-0000-7000-8000-000000000009",
    summary: "Изменён поисковый запрос",
    affectedCount: 1,
    reversible: true,
    finalizedAt: "2026-07-30T12:00:00.000Z",
    createdAt: "2026-07-30T12:00:00.000Z"
  };
}
