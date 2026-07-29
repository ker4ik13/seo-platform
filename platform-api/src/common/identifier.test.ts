import assert from "node:assert/strict";
import test from "node:test";
import { assertUuid } from "./identifier.js";

test("returns a canonical lowercase UUID after validation", () => {
  assert.equal(
    assertUuid(
      "0190ABCD-0000-7000-8000-0000000000EF",
      "workspaceId"
    ),
    "0190abcd-0000-7000-8000-0000000000ef"
  );
});
