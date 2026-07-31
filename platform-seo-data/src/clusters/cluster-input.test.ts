import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticClusterInput,
  internalDeleteSemanticClusterInput,
  internalUpdateSemanticClusterInput
} from "./cluster-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";

test("accepts exact tenant-scoped cluster commands", () => {
  assert.equal(
    internalCreateSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      name: "  SEO   аудит "
    }).name,
    "SEO аудит"
  );
  assert.equal(
    internalUpdateSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      name: "Аудит сайта",
      version: 2
    }).version,
    2
  );
  assert.equal(
    internalDeleteSemanticClusterInput({
      workspaceId,
      projectId,
      actorId,
      version: 3
    }).version,
    3
  );
});

test("rejects malformed and forged internal cluster commands", () => {
  assert.throws(
    () =>
      internalCreateSemanticClusterInput({
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
      internalUpdateSemanticClusterInput({
        workspaceId,
        projectId,
        actorId,
        name: "SEO",
        version: 0
      }),
    BadRequestException
  );
});
