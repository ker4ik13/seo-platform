import assert from "node:assert/strict";
import test from "node:test";
import {
  integrationProviderMetadata,
  operationalIntegrationProviderCatalog
} from "./integration-provider-catalog.js";

test("Arsenkin catalog exposes its documented execution capabilities", () => {
  assert.ok(
    integrationProviderMetadata("ARSENKIN").capabilities.includes(
      "SERP_RANK_TRACKING"
    )
  );
  assert.ok(
    integrationProviderMetadata("ARSENKIN").capabilities.includes(
      "CLUSTERING"
    )
  );
});
test("public catalog only advertises operational provider workflows", () => {
  assert.deepEqual(
    operationalIntegrationProviderCatalog.map(({ provider }) => provider),
    ["XMLSTOCK", "ARSENKIN", "KEYS_SO"]
  );
  assert.deepEqual(
    integrationProviderMetadata("ARSENKIN").capabilities,
    ["SERP_RANK_TRACKING", "SERP_COLLECTION", "WORDSTAT", "CLUSTERING"]
  );
  assert.deepEqual(
    integrationProviderMetadata("KEYS_SO").capabilities,
    ["KEYWORD_RESEARCH", "COMPETITOR_RESEARCH"]
  );
  assert.equal(
    integrationProviderMetadata("XMLSTOCK").credentialValidationMode,
    "ACCOUNT_METADATA"
  );
});
