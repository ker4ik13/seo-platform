import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalSemanticKeywordBulkInput,
  internalSemanticKeywordCleaningInput
} from "./keyword-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";

test("accepts an exact tenant-scoped semantic bulk command", () => {
  const input = internalSemanticKeywordBulkInput({
    workspaceId,
    projectId,
    actorId,
    items: [{ id: keywordId, version: 2 }],
    patch: { priority: 25, groupId: null, tagNames: ["Важно"] }
  });
  assert.equal(input.items[0]?.version, 2);
  assert.deepEqual(input.patch, {
    priority: 25,
    groupId: null,
    tagNames: ["Важно"]
  });
});

test("rejects duplicate bulk rows and empty patches", () => {
  assert.throws(
    () =>
      internalSemanticKeywordBulkInput({
        workspaceId,
        projectId,
        actorId,
        items: [
          { id: keywordId, version: 1 },
          { id: keywordId, version: 2 }
        ],
        patch: { priority: 1 }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSemanticKeywordBulkInput({
        workspaceId,
        projectId,
        actorId,
        items: [{ id: keywordId, version: 1 }],
        patch: {}
      }),
    BadRequestException
  );
});

test("validates exact tenant-scoped keyword cleaning commands", () => {
  const id = "01900000-0000-7000-8000-000000000030";
  const scope = {
    workspaceId: "01900000-0000-7000-8000-000000000001",
    projectId: "01900000-0000-7000-8000-000000000002",
    actorId: "01900000-0000-7000-8000-000000000003"
  };
  assert.deepEqual(
    internalSemanticKeywordCleaningInput({
      ...scope,
      items: [{ id, version: 4 }],
      rules: { normalizeQuotes: true, letterCase: "UPPER" }
    }),
    {
      ...scope,
      items: [{ id, version: 4 }],
      rules: { normalizeQuotes: true, letterCase: "UPPER" }
    }
  );
  assert.throws(() =>
    internalSemanticKeywordCleaningInput({
      ...scope,
      items: [{ id, version: 4 }],
      rules: { letterCase: "KEEP" }
    })
  );
});
