import assert from "node:assert/strict";
import test from "node:test";
import { integrationProviderMetadata } from "./integration-provider-catalog.js";

test("Arsenkin catalog exposes its documented rank-tracking capability", () => {
  assert.ok(
    integrationProviderMetadata("ARSENKIN").capabilities.includes(
      "SERP_RANK_TRACKING"
    )
  );
});
