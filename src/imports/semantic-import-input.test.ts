import assert from "node:assert/strict";
import test from "node:test";
import { BadRequestException } from "@nestjs/common";
import {
  internalCancelSemanticImportInput,
  internalConfigureSemanticImportInput,
  internalConfirmSemanticImportInput
} from "./semantic-import-input.js";

const context = {
  workspaceId: "01900000-0000-7000-8000-000000000001",
  projectId: "01900000-0000-7000-8000-000000000002",
  actorId: "01900000-0000-7000-8000-000000000003"
} as const;

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
      duplicatePolicy: "MERGE_NON_EMPTY"
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
      duplicatePolicy: "MERGE_NON_EMPTY"
    }
  );
  assert.equal(
    internalConfirmSemanticImportInput({ ...context, version: 4 }).version,
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
