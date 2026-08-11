import assert from "node:assert/strict";
import test from "node:test";
import { trackingContextChangedFields } from "./tracking-contexts.js";

test("tracking context events expose only explicit change classes", () => {
  assert.deepEqual(trackingContextChangedFields, [
    "name",
    "configuration",
    "launchProfile",
    "status"
  ]);
});
