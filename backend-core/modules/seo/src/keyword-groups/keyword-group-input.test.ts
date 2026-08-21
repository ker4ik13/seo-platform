import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticKeywordGroupInput,
  internalDeleteSemanticKeywordGroupInput,
  internalDuplicateSemanticKeywordGroupInput,
  internalUpdateSemanticKeywordGroupInput
} from "./keyword-group-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const parentId = "01900000-0000-7000-8000-000000000004";

test("accepts exact tenant-scoped semantic group commands", () => {
  const createInput = internalCreateSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      entitlement: {
        planCode: "PRO",
        planVersion: 1,
        storedKeywords: 10_000,
        keywordsPerProject: 5_000,
        foldersPerProject: 200,
        trackedContextPairs: 5_000
      },
      name: "SEO",
      parentId,
      color: "#6758ef",
      position: 7
    });
  assert.equal(createInput.parentId, parentId);
  assert.equal(createInput.position, 7);
  assert.deepEqual(
    internalUpdateSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 2,
      name: "Продвижение",
      parentId: null,
      color: null,
      position: 4
    }),
    {
      workspaceId,
      projectId,
      actorId,
      version: 2,
      name: "Продвижение",
      parentId: null,
      color: null,
      position: 4
    }
  );
  assert.deepEqual(
    internalUpdateSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 2,
      name: "Продвижение",
      parentId: null,
      color: null,
      position: 20_000
    }).position,
    20_000
  );
  assert.deepEqual(
    internalDeleteSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 3
    }),
    {
      workspaceId,
      projectId,
      actorId,
      version: 3,
      deleteKeywords: false,
      promoteChildren: false
    }
  );
  assert.deepEqual(
    internalDeleteSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 3,
      deleteKeywords: true,
      promoteChildren: true
    }),
    {
      workspaceId,
      projectId,
      actorId,
      version: 3,
      deleteKeywords: true,
      promoteChildren: true
    }
  );
  assert.deepEqual(
    internalDuplicateSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 4,
      name: "SEO — копия",
      parentId,
      color: "#6758ef",
      includeDescendants: true,
      includeKeywords: true
    }),
    {
      workspaceId,
      projectId,
      actorId,
      version: 4,
      name: "SEO — копия",
      parentId,
      color: "#6758ef",
      includeDescendants: true,
      includeKeywords: true
    }
  );
});

test("rejects authority fields and malformed group data", () => {
  assert.throws(
    () =>
      internalCreateSemanticKeywordGroupInput({
        workspaceId,
        projectId,
        actorId,
        name: "SEO",
        version: 1
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticKeywordGroupInput({
        workspaceId,
        projectId,
        actorId,
        version: 0,
        name: "SEO / PPC"
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalUpdateSemanticKeywordGroupInput({
        workspaceId,
        projectId,
        actorId,
        version: 1,
        name: "SEO",
        position: -1
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalDuplicateSemanticKeywordGroupInput({
        workspaceId,
        projectId,
        actorId,
        version: 1,
        name: "SEO",
        includeDescendants: false,
        includeKeywords: "yes"
      }),
    BadRequestException
  );
});
