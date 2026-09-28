import assert from "node:assert/strict";
import test from "node:test";
import {
  isVisibleIntegrationProvider,
  visibleRoutingCapabilities
} from "./integration-visibility.ts";

test("temporarily hides Keys.so without hiding shared keyword research", () => {
  assert.equal(isVisibleIntegrationProvider("XMLSTOCK"), true);
  assert.equal(isVisibleIntegrationProvider("ARSENKIN"), true);
  assert.equal(isVisibleIntegrationProvider("KEYS_SO"), false);
  assert.equal(visibleRoutingCapabilities.includes("COMPETITOR_RESEARCH"), false);
  assert.equal(visibleRoutingCapabilities.includes("KEYWORD_RESEARCH"), true);
});
