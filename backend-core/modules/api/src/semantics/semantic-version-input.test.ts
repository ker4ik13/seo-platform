import assert from "node:assert/strict";
import test from "node:test";
import { DomainError } from "../common/domain-error.js";
import { semanticVersionUndoInput } from "./semantic-version-input.js";

test("semantic undo accepts only an exact empty command", () => {
  assert.deepEqual(semanticVersionUndoInput({}), {});
  assert.throws(() => semanticVersionUndoInput(null), DomainError);
  assert.throws(
    () => semanticVersionUndoInput({ versionId: "authority-field" }),
    DomainError
  );
});
