import assert from "node:assert/strict";
import test from "node:test";
import { safeExceptionDiagnostic } from "./api-exception.filter.js";

test("logs only bounded database codes and identifier targets", () => {
  assert.equal(
    safeExceptionDiagnostic({
      code: "P2002",
      meta: {
        code: "23505",
        target: ["workspace_id", "job_item_id"],
        message: "api_key=must-not-leak user@example.com"
      }
    }),
    "; code=P2002; databaseCode=23505; target=workspace_id,job_item_id"
  );
  assert.equal(
    safeExceptionDiagnostic({
      code: "P2010",
      meta: { target: "bad target; api_key=secret" }
    }),
    "; code=P2010"
  );
});
