import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticKeywordInput,
  internalDeleteSemanticKeywordInput,
  internalUpdateSemanticKeywordInput,
  internalSemanticKeywordBulkCreateInput,
  internalSemanticKeywordBulkInput,
  internalSemanticKeywordCleaningInput
} from "./keyword-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const keywordId = "01900000-0000-7000-8000-000000000004";
const entitlement = {
  planCode: "PRO",
  planVersion: 1,
  storedKeywords: 10_000,
  keywordsPerProject: 5_000,
  foldersPerProject: 200,
  trackedContextPairs: 5_000
};

test("keeps duplicate policy explicit across the trusted create boundary", () => {
  const input = internalCreateSemanticKeywordInput({
    workspaceId,
    projectId,
    actorId,
    entitlement,
    text: "SEO аудит",
    language: "RU",
    priority: 0,
    isFavorite: false,
    tagNames: [],
    duplicatePolicy: "SKIP_EXISTING"
  });
  assert.equal(input.language, "ru");
  assert.equal(input.duplicatePolicy, "SKIP_EXISTING");

  const bulk = internalSemanticKeywordBulkCreateInput({
    workspaceId,
    projectId,
    actorId,
    entitlement,
    duplicatePolicy: "REJECT_EXISTING",
    items: [
      {
        text: "SEO аудит",
        language: "ru",
        priority: 0,
        isFavorite: false,
        tagNames: []
      }
    ]
  });
  assert.equal(bulk.items.length, 1);
  assert.equal(bulk.duplicatePolicy, "REJECT_EXISTING");
  assert.equal(
    internalSemanticKeywordBulkCreateInput({
      workspaceId,
      projectId,
      actorId,
      entitlement,
      duplicatePolicy: "ADD_TO_GROUP",
      items: bulk.items
    }).duplicatePolicy,
    "ADD_TO_GROUP"
  );
});

test("accepts an explicit permanent delete only as a trusted boolean", () => {
  assert.deepEqual(
    internalDeleteSemanticKeywordInput({
      workspaceId,
      projectId,
      actorId,
      version: 3,
      permanent: true
    }),
    { workspaceId, projectId, actorId, version: 3, permanent: true }
  );
  assert.throws(
    () =>
      internalDeleteSemanticKeywordInput({
        workspaceId,
        projectId,
        actorId,
        version: 3,
        permanent: "yes"
      }),
    BadRequestException
  );
});

test("keeps the AI-answer shortcut preference inside the trusted update", () => {
  assert.deepEqual(
    internalUpdateSemanticKeywordInput({
      workspaceId,
      projectId,
      actorId,
      version: 4,
      showAiAnswerButton: false
    }),
    {
      workspaceId,
      projectId,
      actorId,
      version: 4,
      showAiAnswerButton: false
    }
  );
  assert.throws(
    () => internalUpdateSemanticKeywordInput({
      workspaceId,
      projectId,
      actorId,
      version: 4,
      showAiAnswerButton: "no"
    }),
    BadRequestException
  );
});

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
