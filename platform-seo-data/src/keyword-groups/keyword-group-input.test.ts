import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticKeywordGroupInput,
  internalDeleteSemanticKeywordGroupInput,
  internalUpdateSemanticKeywordGroupInput
} from "./keyword-group-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const parentId = "01900000-0000-7000-8000-000000000004";

test("accepts exact tenant-scoped semantic group commands", () => {
  assert.equal(
    internalCreateSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      name: "SEO",
      parentId,
      color: "#6758ef"
    }).parentId,
    parentId
  );
  assert.equal(
    internalUpdateSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 2,
      name: "Продвижение",
      parentId: null,
      color: null
    }).version,
    2
  );
  assert.equal(
    internalDeleteSemanticKeywordGroupInput({
      workspaceId,
      projectId,
      actorId,
      version: 3
    }).version,
    3
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
});
