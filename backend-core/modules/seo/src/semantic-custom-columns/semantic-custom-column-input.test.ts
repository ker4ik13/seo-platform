import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCreateSemanticCustomColumnInput,
  internalDeleteSemanticKeywordCustomValueInput,
  internalSetSemanticKeywordCustomValueInput
} from "./semantic-custom-column-input.js";

const workspaceId = "01900000-0000-7000-8000-000000000001";
const projectId = "01900000-0000-7000-8000-000000000002";
const actorId = "01900000-0000-7000-8000-000000000003";
const scope = { workspaceId, projectId, actorId };

test("accepts exact internal custom-column commands", () => {
  assert.deepEqual(
    internalCreateSemanticCustomColumnInput({
      ...scope,
      name: "Score",
      type: "INTEGER",
      config: { required: false }
    }),
    {
      ...scope,
      name: "Score",
      type: "INTEGER",
      config: { required: false }
    }
  );
  assert.deepEqual(
    internalSetSemanticKeywordCustomValueInput({
      ...scope,
      expectedVersion: 2,
      value: 42
    }),
    { ...scope, expectedVersion: 2, value: 42 }
  );
  assert.deepEqual(
    internalDeleteSemanticKeywordCustomValueInput({
      ...scope,
      version: 3
    }),
    { ...scope, version: 3 }
  );
});

test("rejects malformed scope, config and non-CAS values", () => {
  assert.throws(
    () =>
      internalCreateSemanticCustomColumnInput({
        ...scope,
        projectId: "wrong",
        name: "Score",
        type: "INTEGER",
        config: { required: false }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalCreateSemanticCustomColumnInput({
        ...scope,
        name: "Status",
        type: "STATUS",
        config: { required: false }
      }),
    BadRequestException
  );
  assert.throws(
    () =>
      internalSetSemanticKeywordCustomValueInput({
        ...scope,
        value: 42
      }),
    BadRequestException
  );
});
