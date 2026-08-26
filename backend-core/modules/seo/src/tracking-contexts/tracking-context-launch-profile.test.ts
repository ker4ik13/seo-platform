import assert from "node:assert/strict";
import test from "node:test";
import { trackingContextIncludesUntracked } from "./tracking-context-launch-profile.js";

test("legacy tracking profiles exclude disabled keywords", () => {
  assert.equal(trackingContextIncludesUntracked(undefined), false);
  assert.equal(trackingContextIncludesUntracked({ searchSource: "LIVE" }), false);
});

test("tracking profile uses only an explicit boolean override", () => {
  assert.equal(trackingContextIncludesUntracked({ includeUntracked: true }), true);
  assert.equal(trackingContextIncludesUntracked({ includeUntracked: false }), false);
  assert.throws(
    () => trackingContextIncludesUntracked({ includeUntracked: "true" }),
    /launch profile is invalid/u
  );
});
