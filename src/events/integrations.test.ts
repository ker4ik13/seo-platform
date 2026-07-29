import assert from "node:assert/strict";
import test from "node:test";
import { projectConnectorBindingChangedFields } from "./integrations.js";

test("project connector event change fields stay explicit and redacted", () => {
  assert.deepEqual(projectConnectorBindingChangedFields, [
    "enabled",
    "route",
    "fallbackPolicy",
    "budgetPolicy"
  ]);
  assert.equal(
    projectConnectorBindingChangedFields.some((field) =>
      field.toLowerCase().includes("credential")
    ),
    false
  );
});
